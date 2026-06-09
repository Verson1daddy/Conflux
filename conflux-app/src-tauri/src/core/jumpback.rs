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

/// 终端行区间（§5.1）。
///
/// 行号语义来自前端 xterm.js 的逻辑行（由结构化事件触发 `registerMarker` 记录），
/// **后端不通过 PTY 正则推断、不伪造行号**（§5「禁止用 PTY 正则推断落点」）。
/// 后端当前 PTY 缓冲为字节环形缓冲（`pty/buffer.rs`），不维护行索引，
/// 因此 V1 后端默认退化为 `Card`；`TerminalRange` 仅在调用方显式提供可靠行号时生成。
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub struct TerminalRange {
    /// 起始行（含）
    pub start_line: usize,
    /// 结束行（含）
    pub end_line: usize,
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

    /// 构造一个终端行区间落点（confidence High）。
    ///
    /// 仅当调用方持有**可靠**行号时使用（V1 后端默认无行号 → 不走此路径；
    /// 保留给 P5 前端 xterm marker 回填或测试构造）。
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

    /// 从一个结构化事件派生回场落点（§5 落点驱动）。
    ///
    /// 派生策略（V1 真实能力边界）：
    ///   - 能拿到 `instance_id`（PermissionRequested / ErrorOccurred / TaskCompleted /
    ///     ProcessExited 等）→ 生成 `Card`（confidence Medium）。
    ///     **后端 PTY 缓冲不维护行号，故 V1 不生成 `TerminalRange`，也绝不伪造行号**；
    ///     精确行号在 P5 由前端 xterm `registerMarker` 回填。
    ///   - 拿不到 `instance_id`（如纯讨论消息）→ `FallbackContext` + 事件摘要，
    ///     confidence Low，**不静默失败**。
    ///
    /// 返回 `None` 仅当事件本身非"应生成落点"的类别（高频 PtyOutput 等）——
    /// 但本函数对 attention 必上浮事件总会返回 `Some`（与 ingest 一致）。
    pub fn derive_from_event(event: &ConfluxEvent) -> Option<Self> {
        // 高频原始输出——不为其建落点
        if matches!(event, ConfluxEvent::PtyOutput { .. }) {
            return None;
        }

        let summary = event_summary(event);

        match event.instance_id() {
            Some(instance_id) => Some(Self::card(instance_id.clone(), None)),
            // 无实例（如 DiscussionMessage）→ 兜底上下文，不静默失败
            None => Some(Self::fallback(summary, None, None)),
        }
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
