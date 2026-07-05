// ===== Conflux 控制面语义层 P4: 精确回场对象 JumpBackTarget =====
// 本文件定义 JumpBackTarget 及其枚举（F1 控制面契约 §5.1）+ 由结构化事件派生
// 落点对象的纯函数 `derive_from_event`。
//
// 对应 F1 控制面契约 §5（JumpBackTarget，「没有 jump back 就没有完整闭环」）。
// serde rename_all = "snake_case"，与前端 src/types/jumpback.ts 字段镜像对齐。
//
// ============================================================================
// 安全约束 §13.8（MF-9）—— V1 jump-back 仅 app 内部聚焦：
//   - JumpBackTarget **只允许驱动 app 内部聚焦**（聚焦卡片 / 展开终端滚动到行）。
//   - **结构上不得包含任何 external_uri / file_ref / 可驱动 shell.open 的字段**，
//     也不提供任何返回外部 URI 的方法。前端拿到本对象**只能**做 app 内部导航。
//   - `cwd` 字段仅作**展示 fallback**（给用户看"这是哪个工作目录的事件"），
//     **绝不作为 shell.open / 外部打开的入参**——这一约束在类型层面保证：
//     本结构体没有任何 open / launch / external 语义字段或方法。
//   - V1.1+ 若引入 external 落点，须另立 scheme allowlist + canonicalize +
//     限定 session working_dir 子树的受治理类型，不在本结构体直接扩展 open 能力。
// ============================================================================
//
// V1 落点范围（§5.1）：
//   - `Card`          → 聚焦该 instance 对应卡片（confidence Medium）。
//   - `TerminalRange` → 展开终端并滚动到事件落点行（需可靠行号；行号由前端
//                       xterm.js `registerMarker` 在 P5 记录，**后端不伪造行号**）。
//   - `FallbackContext` → 无任何可靠落点时的兜底：带 fallback_summary + cwd，
//                       confidence Low，**不静默失败**（§5 / §17.3）。
//   - `Terminal` / `Artifact` / `DiscussionMessage` 枚举值定义但 V1 不生成。

use serde::{Deserialize, Serialize};
use uuid::Uuid;

use crate::core::event::ConfluxEvent;
use crate::core::types::InstanceId;

/// 回场落点类型（§5.1）
///
/// V1 仅**生成** `Card` / `TerminalRange` / `FallbackContext` 三种；
/// 其余值定义保留，V1.1+ 再启用（`Artifact` / `DiscussionMessage`）或保留语义对齐
/// （`Terminal` = 仅展开终端不带具体行，当前由 `Card` 覆盖）。
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum JumpKind {
    /// 聚焦实例对应卡片
    Card,
    /// 展开终端（不带具体行）——V1 不生成，由 Card 覆盖
    Terminal,
    /// 展开终端并滚动到事件落点行区间
    TerminalRange,
    /// 跳到产物（V1.1+）
    Artifact,
    /// 跳到讨论消息（V1.1+）
    DiscussionMessage,
    /// 无精确落点的兜底上下文（带摘要 + cwd，不静默失败）
    FallbackContext,
}

/// 行号坐标系（mux 契约 §4.3，V1-core）。
///
/// 两套行号语义并存，必须显式标注消歧：
/// - `Xterm`：前端 xterm.js 逻辑行（`registerMarker` 记录）——可精确滚动，confidence 可 High。
/// - `BackendAbs`：conmux scrollback 写入侧物理行（自 pane 创建起按 `\n` 计，单调递增、
///   环覆盖不回退）——**不等于** xterm 视口行；confidence 强制 ≤ Medium，前端**不得**
///   据此精确 scrollToLine（只做近似定位 + UI 显式标注非精确，防误滚导致用户据错误
///   上下文批权限）。
#[derive(Debug, Clone, Copy, PartialEq, Eq, Default, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum CoordSpace {
    /// 前端 xterm marker 行号（默认——serde default 保持旧数据向后兼容）
    #[default]
    Xterm,
    /// 后端 scrollback 绝对行号（conmux abs_line）
    BackendAbs,
}

/// 终端行区间（§5.1 + mux 契约 §4.2/4.3）。
///
/// 行号来源两轨（见 [`CoordSpace`]）：前端 xterm marker（精确）或后端 conmux 行索引
/// scrollback 高水位（近似，V1-core 起后端可生成）。**后端不通过 PTY 正则推断行号**
/// （§5「禁止用 PTY 正则推断落点」不变——abs_line 是写入侧字节计数，非正则猜测）。
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub struct TerminalRange {
    /// 起始行（含）
    pub start_line: u64,
    /// 结束行（含）
    pub end_line: u64,
    /// 行号坐标系（serde default = Xterm，旧库 JSON 无此键时向后兼容）
    #[serde(default)]
    pub coord_space: CoordSpace,
}

/// 落点置信度（§5.1）。
///
/// - `High`   → 有可靠终端行号（TerminalRange，精确滚动）。
/// - `Medium` → 仅能定位到实例卡片（Card）。
/// - `Low`    → 无任何可靠落点，仅有兜底上下文（FallbackContext）。
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum JumpConfidence {
    High,
    Medium,
    Low,
}

/// 精确回场对象（§5.1）。
///
/// **§13.8 内部聚焦约束（类型层面保证）**：本结构体仅含 app 内部定位字段
/// （instance_id / card_id / terminal_range）+ 展示性 cwd / fallback_summary。
/// **没有** external_uri / file_ref / open / launch 等可驱动 `shell.open` 或外部
/// URI 的字段或方法——前端据此**只能**做 app 内部聚焦。
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub struct JumpBackTarget {
    /// 落点唯一 ID（uuid v4）
    pub jump_back_target_id: String,
    /// 落点类型
    pub target_kind: JumpKind,
    /// 关联的 agent 实例（用于聚焦卡片/终端，可空）
    pub instance_id: Option<InstanceId>,
    /// 目标卡片 ID（V1 一卡绑一 session，等于 instance_id，可空）
    pub card_id: Option<String>,
    /// 终端行区间（仅 TerminalRange 有值；后端不伪造行号）
    pub terminal_range: Option<TerminalRange>,
    /// 工作目录——**仅展示 fallback**，绝不作 shell.open 入参（§13.8）
    pub cwd: Option<String>,
    /// 兜底上下文摘要（FallbackContext 必非空——不静默失败）
    pub fallback_summary: Option<String>,
    /// 落点置信度
    pub confidence: JumpConfidence,
}

impl JumpBackTarget {
    /// 生成一个新的 uuid v4 落点 ID
    pub fn new_id() -> String {
        Uuid::new_v4().to_string()
    }

    /// 构造一个聚焦卡片的落点（confidence Medium）。
    ///
    /// V1 主路径：能定位到实例 → 聚焦其卡片。`card_id` 默认等于 `instance_id`
    /// （一卡绑一 session）。`cwd` 仅作展示，可为 None。
    pub fn card(instance_id: InstanceId, cwd: Option<String>) -> Self {
        let card_id = Some(instance_id.0.clone());
        Self {
            jump_back_target_id: Self::new_id(),
            target_kind: JumpKind::Card,
            instance_id: Some(instance_id),
            card_id,
            terminal_range: None,
            cwd,
            fallback_summary: None,
            confidence: JumpConfidence::Medium,
        }
    }

    /// 构造一个终端行区间落点——**前端 xterm marker 源**（Xterm + confidence High）。
    ///
    /// 仅当调用方持有前端 marker 行号时使用（P5 前端回填或测试构造）。
    /// 后端 abs_line 源走 [`Self::terminal_range_backend`]。
    pub fn terminal_range(
        instance_id: InstanceId,
        range: TerminalRange,
        cwd: Option<String>,
    ) -> Self {
        let card_id = Some(instance_id.0.clone());
        Self {
            jump_back_target_id: Self::new_id(),
            target_kind: JumpKind::TerminalRange,
            instance_id: Some(instance_id),
            card_id,
            terminal_range: Some(range),
            cwd,
            fallback_summary: None,
            confidence: JumpConfidence::High,
        }
    }

    /// 构造一个终端行区间落点——**后端 scrollback abs_line 源**
    /// （BackendAbs + **confidence 强制 Medium**，复闸 C5 / 契约 §4.3「≤ Medium」）。
    ///
    /// confidence 不接受调用方指定：BackendAbs 行号与 xterm 视口行存在坐标系差，
    /// 不得以 High 误导前端精确滚动。
    pub fn terminal_range_backend(
        instance_id: InstanceId,
        start_line: u64,
        end_line: u64,
        cwd: Option<String>,
    ) -> Self {
        let card_id = Some(instance_id.0.clone());
        Self {
            jump_back_target_id: Self::new_id(),
            target_kind: JumpKind::TerminalRange,
            instance_id: Some(instance_id),
            card_id,
            terminal_range: Some(TerminalRange {
                start_line,
                end_line,
                coord_space: CoordSpace::BackendAbs,
            }),
            cwd,
            fallback_summary: None,
            confidence: JumpConfidence::Medium,
        }
    }

    /// 构造一个兜底上下文落点（confidence Low）——**不静默失败**（§5 / §17.3）。
    ///
    /// 无任何可靠落点（如缺实例信息）时使用：必带 `fallback_summary`（事件摘要），
    /// 可带 `cwd`（仅展示）。前端据此至少给用户一句"发生了什么"的上下文。
    pub fn fallback(summary: String, instance_id: Option<InstanceId>, cwd: Option<String>) -> Self {
        let card_id = instance_id.as_ref().map(|i| i.0.clone());
        Self {
            jump_back_target_id: Self::new_id(),
            target_kind: JumpKind::FallbackContext,
            instance_id,
            card_id,
            terminal_range: None,
            cwd,
            fallback_summary: Some(summary),
            confidence: JumpConfidence::Low,
        }
    }

    /// 是否为不可静默失败的兜底类型（FallbackContext 必带非空摘要）。
    pub fn is_fallback(&self) -> bool {
        self.target_kind == JumpKind::FallbackContext
    }

    /// 从一个结构化事件派生回场落点（§5 落点驱动 + mux 契约 §4.3 行级升级）。
    ///
    /// 派生策略（V1-core）：
    ///   - 有 `instance_id` 且调用方提供 scrollback 高水位 `line_hint`（conmux
    ///     `pane_state().scrollback.last_abs_line`）→ `TerminalRange`（BackendAbs，
    ///     区间 = `[hi - CONTEXT_LINES, hi]`，confidence Medium）。
    ///   - 有 `instance_id` 无 hint（pane 已死/无输出）→ `Card`（confidence Medium）。
    ///   - 无 `instance_id`（如纯讨论消息）→ `FallbackContext` + 事件摘要，
    ///     confidence Low，**不静默失败**。
    ///
    /// **禁止**：用 PTY 正则猜行号（§5 不变）——hint 只能来自 conmux 行索引高水位。
    ///
    /// 返回 `None` 仅当事件本身非"应生成落点"的类别（高频 PtyOutput 等）。
    pub fn derive_from_event(event: &ConfluxEvent, line_hint: Option<u64>) -> Option<Self> {
        // 高频原始输出——不为其建落点
        if matches!(event, ConfluxEvent::PtyOutput { .. }) {
            return None;
        }

        let summary = event_summary(event);

        match (event.instance_id(), line_hint) {
            (Some(instance_id), Some(hi)) => Some(Self::terminal_range_backend(
                instance_id.clone(),
                hi.saturating_sub(CONTEXT_LINES),
                hi,
                None,
            )),
            (Some(instance_id), None) => Some(Self::card(instance_id.clone(), None)),
            // 无实例（如 DiscussionMessage）→ 兜底上下文，不静默失败
            (None, _) => Some(Self::fallback(summary, None, None)),
        }
    }
}

/// 行级落点的上下文行数（区间 = 高水位前 N 行到高水位；对齐 raw_context 前后 5 行惯例）。
const CONTEXT_LINES: u64 = 5;

/// 消费时降级链（mux 契约 §4.3 冻结，「不静默失败」）——对 BackendAbs 行级落点按
/// pane **现时**可读窗口判定（纯函数，命令层取窗后调用）：
///
/// - `window=None`（pane 已死/移除）→ 降级 `FallbackContext`（summary 注明原落点失效，
///   保留 instance/cwd 展示）。
/// - 目标起始行已被环覆盖（`start_line < window.0`）→ 降级 `Card`（confidence Medium）。
/// - 仍可达 → 原样返回。
///
/// Xterm 源与非 TerminalRange 落点不经此函数变换（前端 marker 有效性由前端判断）。
/// 存储不可变（jump_back_targets 仅 INSERT+SELECT）——降级只发生在返回副本上。
pub fn degrade_backend_range_target(
    target: JumpBackTarget,
    window: Option<(u64, u64)>,
) -> JumpBackTarget {
    let range = match &target.terminal_range {
        Some(r)
            if target.target_kind == JumpKind::TerminalRange
                && r.coord_space == CoordSpace::BackendAbs =>
        {
            *r
        }
        _ => return target,
    };

    match window {
        None => {
            let summary = format!(
                "原行级落点已失效（pane 已结束）：{}",
                target
                    .instance_id
                    .as_ref()
                    .map(|i| i.0.as_str())
                    .unwrap_or("<unknown>")
            );
            JumpBackTarget {
                jump_back_target_id: target.jump_back_target_id,
                target_kind: JumpKind::FallbackContext,
                instance_id: target.instance_id,
                card_id: target.card_id,
                terminal_range: None,
                cwd: target.cwd,
                fallback_summary: Some(summary),
                confidence: JumpConfidence::Low,
            }
        }
        Some((first, _last)) if range.start_line < first => JumpBackTarget {
            target_kind: JumpKind::Card,
            terminal_range: None,
            confidence: JumpConfidence::Medium,
            ..target
        },
        Some(_) => target,
    }
}

/// 死 pane 兜底降级（补 [`degrade_backend_range_target`] 的空白）。
///
/// `degrade_backend_range_target` 只处理 **BackendAbs 行级**落点；`Card` 与前端
/// xterm 源 `TerminalRange` 落点若其来源 pane 已死（`pane_alive=false`），前端
/// `focusCard` 会**静默 no-op**（卡片已不在画布）——点了 Jump 什么都不发生。
/// 这里把它降级为 `FallbackContext`，让用户看到「这条线索已失效」而非以为按钮坏了
/// （§5「不静默失败」）。已是 `FallbackContext` / 无 instance / pane 仍活 → 原样返回。
pub fn degrade_dead_pane_target(target: JumpBackTarget, pane_alive: bool) -> JumpBackTarget {
    if pane_alive || target.target_kind == JumpKind::FallbackContext {
        return target;
    }
    // 需要 instance 才谈得上"聚焦卡片"；无 instance 的落点前端已走 fallback，勿动。
    let instance_label = match target.instance_id.as_ref() {
        Some(i) => i.0.clone(),
        None => return target,
    };
    match target.target_kind {
        JumpKind::Card | JumpKind::Terminal | JumpKind::TerminalRange => JumpBackTarget {
            jump_back_target_id: target.jump_back_target_id,
            target_kind: JumpKind::FallbackContext,
            instance_id: target.instance_id,
            card_id: target.card_id,
            terminal_range: None,
            cwd: target.cwd,
            fallback_summary: Some(format!(
                "原落点已失效（agent 已退出或其卡片已关闭）：{}",
                instance_label
            )),
            confidence: JumpConfidence::Low,
        },
        _ => target,
    }
}

/// 为事件生成一句人类可读摘要（兜底落点用，避免静默失败）。
fn event_summary(event: &ConfluxEvent) -> String {
    match event {
        ConfluxEvent::PermissionRequested { request, .. } => {
            format!("权限请求: {} — {}", request.action, request.description)
        }
        ConfluxEvent::ErrorOccurred { error_message, .. } => {
            format!("错误: {}", error_message)
        }
        ConfluxEvent::TaskCompleted { summary, .. } => format!("任务完成: {}", summary),
        ConfluxEvent::ProcessExited {
            exit_code, signal, ..
        } => match (exit_code, signal) {
            (_, Some(sig)) => format!("进程退出（信号 {}）", sig),
            (Some(code), None) => format!("进程退出（退出码 {}）", code),
            (None, None) => "进程退出".to_string(),
        },
        other => format!("事件: {}", other.event_type_name()),
    }
}
