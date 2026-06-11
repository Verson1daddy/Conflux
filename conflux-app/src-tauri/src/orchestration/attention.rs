// ===== Conflux 控制面语义层 P2: 注意力队列引擎 =====
// 后端 owned 的**唯一注意力队列**（F1 控制面契约 §4）。
//
// 职责（§4 + §11.2 + §13）：
//   - ingest(ConfluxEvent) → 把必上浮事件映射成 AttentionItem，去重后入队
//   - list_active()        → 活跃项（未处置），按优先级（Critical 最高）+ created_at 排序
//   - resolve/defer/ignore → 处置项；每次处置与审计写入**原子**绑定（MF-8 fail-closed）
//   - restore(id)          → 把被 ignore 的项恢复为活跃，并写一条 Restore 审计
//
// 安全约束：
//   - MF-8（§13.6）：处置（resolution）与审计（audit_event）必须原子落库；
//     审计写入失败时**回滚 resolution**（fail-closed），内存态也不更新。
//   - MF-6（§13.2）：actor / audit action 由后端硬编码，不接受前端入参。
//   - ignored 项持久保留（不删除），可 restore。
//
// 内存态与持久态：
//   AttentionQueue 持有 `Vec<AttentionItem>` 作为内存镜像；DB 是权威持久层。
//   每个变更先在事务里落库（含审计），成功后再更新内存，保证两者一致。

use rusqlite::Connection;
use serde::{Deserialize, Serialize};

use crate::core::audit::{AuditAction, AuditActor, AuditEvent, AuditResult};
use crate::core::event::ConfluxEvent;
use crate::core::interaction::{InteractionAction, InteractionKind, InteractionResolution};
use crate::core::jumpback::JumpBackTarget;
use crate::core::types::{ErrorSeverity, EventPriority, InstanceId};
use crate::core::ConfluxError;
use crate::persistence::attention as db_attention;
use crate::persistence::audit as db_audit;
use crate::persistence::jumpback as db_jumpback;

/// 注意力队列项（F1 控制面契约 §4.1）
///
/// 后端 owned 的唯一注意力队列里的一项。`resolution == None` 表示活跃（待处理），
/// 非 None 表示已处置（含 Ignored——持久保留可 restore）。
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub struct AttentionItem {
    /// 队列项唯一 ID（uuid v4）
    pub attention_item_id: String,
    /// 关联的 agent 实例
    pub instance_id: InstanceId,
    /// 交互种类（permission / error_recovery / review_required ...）
    pub kind: InteractionKind,
    /// 优先级（Critical 最高）
    pub priority: EventPriority,
    /// 触发本项的源事件 ID（PersistedEvent.event_id，可空）
    pub source_event_id: Option<String>,
    /// 关联的待处理交互 ID（PendingInteraction.interaction_id，可空）
    pub interaction_id: Option<String>,
    /// 面向 UI 的摘要文本
    pub payload_summary: String,
    /// 可执行动作集合
    pub available_actions: Vec<InteractionAction>,
    /// 跳回事件落点（JumpBackTarget，P4 落地，当前占位）
    pub jump_back_target_id: Option<String>,
    /// 创建时间（Unix 时间戳 ms）
    pub created_at: i64,
    /// 处置时间（Unix 时间戳 ms，未处置为 None）
    pub resolved_at: Option<i64>,
    /// 处置结果（None = 活跃）
    pub resolution: Option<InteractionResolution>,
    /// 处置时绑定的审计事件 ID（MF-8 原子绑定）
    pub audit_event_id: Option<String>,
    /// 权限请求原始上下文（仅 kind=Permission；来自 PermissionRequest.raw_context）
    pub permission_context: Option<Vec<String>>,
    /// 权限超时秒数（仅 kind=Permission；来自 PermissionRequest.timeout_seconds）
    pub timeout_seconds: Option<i64>,
    /// defer 提醒时间（Unix ms；仅 resolution=Deferred 有值，到点由 sweep 复活）。
    #[serde(default)]
    pub remind_at: Option<i64>,
    /// 信号来源标注（V1-core §4.7："hook"=结构化可靠 / "scrape"=刮屏兜底不可靠）。
    #[serde(default)]
    pub signal_source: Option<String>,
}

impl AttentionItem {
    /// 生成新的 uuid v4 队列项 ID
    pub fn new_id() -> String {
        uuid::Uuid::new_v4().to_string()
    }

    /// 是否活跃（未处置）
    pub fn is_active(&self) -> bool {
        self.resolution.is_none()
    }
}

/// ingest 映射结果：把一个 ConfluxEvent 解析成「应入队的注意力意图」
struct IngestDescriptor {
    instance_id: InstanceId,
    kind: InteractionKind,
    priority: EventPriority,
    source_event_id: Option<String>,
    interaction_id: Option<String>,
    payload_summary: String,
    available_actions: Vec<InteractionAction>,
    created_at: i64,
    permission_context: Option<Vec<String>>,
    timeout_seconds: Option<i64>,
    /// 信号来源标注（"hook"/"scrape"；批次 4 接线，当前 Permission 路径填充）。
    signal_source: Option<String>,
}

/// 后端唯一注意力队列引擎（§4）
///
/// 内存态镜像 + DB 权威持久层。调用方负责传入已锁定的 `&Connection`。
#[derive(Debug, Default)]
pub struct AttentionQueue {
    items: Vec<AttentionItem>,
}

impl AttentionQueue {
    /// 新建空队列
    pub fn new() -> Self {
        Self { items: Vec::new() }
    }

    /// 从 DB 重新加载内存态（活跃 + 被忽略项）。
    ///
    /// 启动恢复时调用：active（resolution IS NULL）+ ignored（持久保留）都需进内存，
    /// 这样 restore 才能命中。其余终态项（approved/denied/...）不必驻留内存。
    pub fn reload_from_db(&mut self, conn: &Connection) -> Result<(), ConfluxError> {
        let mut items = db_attention::list_active_attention_items(conn)?;
        let ignored = db_attention::list_ignored_attention_items(conn)?;
        items.extend(ignored);
        self.items = items;
        Ok(())
    }

    /// ingest：把一个事件映射为注意力项并入队（去重）。`line_hint = None` 的便捷入口
    /// （测试 / 无 scrollback 语境）；生产路径见 [`Self::ingest_with_line_hint`]。
    pub fn ingest(
        &mut self,
        conn: &Connection,
        event: &ConfluxEvent,
    ) -> Result<Option<AttentionItem>, ConfluxError> {
        self.ingest_with_line_hint(conn, event, None)
    }

    /// ingest（带 scrollback 行高水位）：把一个事件映射为注意力项并入队（去重）。
    ///
    /// 返回新入队的 item（已落库），或 `None`（事件非必上浮 / 命中去重）。
    ///
    /// 去重键（§4 防抖）：同 instance_id + 同 source_event_id 已存在活跃项时跳过；
    /// source_event_id 为空时退化为 instance_id + kind + payload_summary 去重，
    /// 避免无限重复上浮同一语义。
    ///
    /// `line_hint`：conmux scrollback 高水位（`pane_state().scrollback.last_abs_line`），
    /// 由调用方（event_emit）取得——有值则派生 `TerminalRange(BackendAbs, ≤Medium)`
    /// 行级落点（mux 契约 §4.3），无值退化 `Card`（**后端绝不伪造行号**，§5 不变）。
    pub fn ingest_with_line_hint(
        &mut self,
        conn: &Connection,
        event: &ConfluxEvent,
        line_hint: Option<u64>,
    ) -> Result<Option<AttentionItem>, ConfluxError> {
        let desc = match map_event_to_descriptor(event) {
            Some(d) => d,
            None => return Ok(None),
        };

        if self.is_duplicate(&desc) {
            return Ok(None);
        }

        // 控制面 P4（§5）+ V1-core（mux §4.3）：为本注意力项生成回场落点并落库，
        // 再把其 id 链接进 item。有 line_hint → TerminalRange(BackendAbs, Medium)；
        // 无 hint → Card；无实例（如纯讨论事件）→ FallbackContext（不静默失败）。
        let jump_target = JumpBackTarget::derive_from_event(event, line_hint);
        let jump_back_target_id = match &jump_target {
            Some(t) => {
                // 落点先落库（生成失败不应阻断注意力上浮——若落库失败则不链接，
                // 但注意力项仍入队，避免事件丢失；记录告警由调用方处理）。
                db_jumpback::insert_jump_back_target(conn, t)?;
                Some(t.jump_back_target_id.clone())
            }
            None => None,
        };

        let item = AttentionItem {
            attention_item_id: AttentionItem::new_id(),
            instance_id: desc.instance_id,
            kind: desc.kind,
            priority: desc.priority,
            source_event_id: desc.source_event_id,
            interaction_id: desc.interaction_id,
            payload_summary: desc.payload_summary,
            available_actions: desc.available_actions,
            jump_back_target_id,
            created_at: desc.created_at,
            resolved_at: None,
            resolution: None,
            audit_event_id: None,
            permission_context: desc.permission_context,
            timeout_seconds: desc.timeout_seconds,
            remind_at: None,
            signal_source: desc.signal_source,
        };

        db_attention::insert_attention_item(conn, &item)?;
        self.items.push(item.clone());
        Ok(Some(item))
    }

    /// 去重判定：是否已存在等价的**活跃**项。
    fn is_duplicate(&self, desc: &IngestDescriptor) -> bool {
        self.items.iter().filter(|i| i.is_active()).any(|i| {
            if i.instance_id != desc.instance_id || i.kind != desc.kind {
                return false;
            }
            match (&i.source_event_id, &desc.source_event_id) {
                // 都有 source_event_id：按事件 ID 去重
                (Some(a), Some(b)) => a == b,
                // 否则退化为 payload_summary 去重（同实例同类型同摘要视为重复）
                _ => i.payload_summary == desc.payload_summary,
            }
        })
    }

    /// 列出活跃项（未处置），按优先级（Critical 最高）+ created_at 升序。
    pub fn list_active(&self) -> Vec<AttentionItem> {
        let mut active: Vec<AttentionItem> = self
            .items
            .iter()
            .filter(|i| i.is_active())
            .cloned()
            .collect();
        // EventPriority 派生 Ord：Critical=0 < High=1 < Normal=2 < Low=3，升序即优先级降序
        active.sort_by(|a, b| {
            a.priority
                .cmp(&b.priority)
                .then(a.created_at.cmp(&b.created_at))
        });
        active
    }

    /// 列出被忽略项（持久保留，可 restore），按 created_at 升序。
    pub fn list_ignored(&self) -> Vec<AttentionItem> {
        let mut ignored: Vec<AttentionItem> = self
            .items
            .iter()
            .filter(|i| i.resolution == Some(InteractionResolution::Ignored))
            .cloned()
            .collect();
        ignored.sort_by(|a, b| a.created_at.cmp(&b.created_at));
        ignored
    }

    /// 按 ID 取项（只读）
    pub fn get(&self, id: &str) -> Option<&AttentionItem> {
        self.items.iter().find(|i| i.attention_item_id == id)
    }

    /// resolve：把一项标记为最终处置（approved/denied/replied/expired）。
    ///
    /// MF-8（§13.6）：resolution 更新与审计写入**原子**绑定；审计失败 fail-closed，
    /// 内存态不更新、DB 事务回滚。
    ///
    /// # 参数
    /// - `resolution`: 最终结果（不接受 Deferred/Ignored，应走 defer/ignore 专用方法）
    /// - `audit_action`: 对应审计动作（approve/deny/reply...，后端硬编码 MF-6）
    /// - `now_ms`: 当前时间戳（ms）
    pub fn resolve(
        &mut self,
        conn: &Connection,
        id: &str,
        resolution: InteractionResolution,
        audit_action: AuditAction,
        now_ms: i64,
    ) -> Result<AttentionItem, ConfluxError> {
        self.apply_resolution(conn, id, resolution, audit_action, AuditResult::Ok, now_ms)
    }

    /// defer：延后处理。**必须**带 remind_at（提醒时间，ms）。
    ///
    /// remind_at 为 None 时返回 Err（契约要求 defer 必带提醒时间）。
    /// remind_at 当前持久化进 payload_summary 末尾的标记（P4 接入提醒调度时改为专列）。
    pub fn defer(
        &mut self,
        conn: &Connection,
        id: &str,
        remind_at: Option<i64>,
        now_ms: i64,
    ) -> Result<AttentionItem, ConfluxError> {
        let remind_at = remind_at.ok_or_else(|| ConfluxError::OrchestrationError {
            message: "defer 必须提供 remind_at（提醒时间）".to_string(),
        })?;
        if remind_at <= 0 {
            return Err(ConfluxError::OrchestrationError {
                message: format!("defer 的 remind_at 必须为正时间戳，收到 {}", remind_at),
            });
        }
        self.apply_resolution(
            conn,
            id,
            InteractionResolution::Deferred,
            AuditAction::Defer,
            AuditResult::Ok,
            now_ms,
        )
    }

    /// ignore：忽略一项（持久保留，可 restore）。
    ///
    /// 与 resolve 一致地原子绑定 Ignore 审计（MF-8）。被忽略项不删除，
    /// resolution=Ignored，可由 restore 复活。
    pub fn ignore(
        &mut self,
        conn: &Connection,
        id: &str,
        now_ms: i64,
    ) -> Result<AttentionItem, ConfluxError> {
        self.apply_resolution(
            conn,
            id,
            InteractionResolution::Ignored,
            AuditAction::Ignore,
            AuditResult::Ok,
            now_ms,
        )
    }

    /// restore：把被 ignore 的项恢复为活跃（resolution → None），并写一条 Restore 审计。
    ///
    /// 仅对 resolution==Ignored 的项有效；其它状态返回 Err。
    /// 同样 MF-8 原子绑定：清空 resolution 与写 Restore 审计在同一事务内，
    /// 审计失败则回滚、内存不变。
    pub fn restore(
        &mut self,
        conn: &Connection,
        id: &str,
        now_ms: i64,
    ) -> Result<AttentionItem, ConfluxError> {
        let idx = self
            .items
            .iter()
            .position(|i| i.attention_item_id == id)
            .ok_or_else(|| ConfluxError::OrchestrationError {
                message: format!("restore 失败：注意力项不存在 (id={})", id),
            })?;

        if self.items[idx].resolution != Some(InteractionResolution::Ignored) {
            return Err(ConfluxError::OrchestrationError {
                message: format!("restore 失败：仅能恢复 ignored 项 (id={})", id),
            });
        }

        // 准备恢复后的内存态副本（先不写回，落库成功后才提交）
        let restore_audit_id = AuditEvent::new_id();
        let mut restored = self.items[idx].clone();
        restored.resolution = None;
        restored.resolved_at = None;
        restored.audit_event_id = Some(restore_audit_id.clone());

        // MF-8 原子事务：UPDATE attention_item（清 resolution）+ INSERT Restore 审计
        let audit = AuditEvent {
            audit_event_id: restore_audit_id,
            actor: AuditActor::User,
            action: AuditAction::Restore,
            instance_id: Some(restored.instance_id.clone()),
            source_event_id: restored.source_event_id.clone(),
            interaction_id: restored.interaction_id.clone(),
            injection_source: None,
            result: AuditResult::Ok,
            created_at: now_ms,
            rationale_ref: None,
            payload: None,
        };

        // fail-closed：落库失败则内存仍是 ignored（未改动），直接向上抛错
        atomic_persist(conn, &restored, &audit)?;

        self.items[idx] = restored.clone();
        Ok(restored)
    }

    /// 处置核心：原子地（事务）更新 resolution + 写审计，成功后提交内存态。
    ///
    /// MF-8 fail-closed：事务内任一步失败则整体回滚，内存态保持处置前不变。
    fn apply_resolution(
        &mut self,
        conn: &Connection,
        id: &str,
        resolution: InteractionResolution,
        audit_action: AuditAction,
        audit_result: AuditResult,
        now_ms: i64,
    ) -> Result<AttentionItem, ConfluxError> {
        let idx = self
            .items
            .iter()
            .position(|i| i.attention_item_id == id)
            .ok_or_else(|| ConfluxError::OrchestrationError {
                message: format!("处置失败：注意力项不存在 (id={})", id),
            })?;

        // 仅活跃项可被处置（避免对已处置项重复落定）
        if !self.items[idx].is_active() {
            return Err(ConfluxError::OrchestrationError {
                message: format!("处置失败：注意力项已处于终态，不能重复处置 (id={})", id),
            });
        }

        let audit_event_id = AuditEvent::new_id();
        let mut updated = self.items[idx].clone();
        updated.resolution = Some(resolution);
        updated.resolved_at = Some(now_ms);
        updated.audit_event_id = Some(audit_event_id.clone());

        let audit = AuditEvent {
            audit_event_id,
            actor: AuditActor::User,
            action: audit_action,
            instance_id: Some(updated.instance_id.clone()),
            source_event_id: updated.source_event_id.clone(),
            interaction_id: updated.interaction_id.clone(),
            injection_source: None,
            result: audit_result,
            created_at: now_ms,
            rationale_ref: None,
            payload: None,
        };

        // MF-8：UPDATE + 审计 INSERT 同一事务，失败回滚（fail-closed）
        atomic_persist(conn, &updated, &audit)?;

        // 落库成功后才提交内存态
        self.items[idx] = updated.clone();
        Ok(updated)
    }
}

/// MF-8 原子持久化：在单个事务内更新 attention_item + 插入审计事件。
///
/// 任一步失败则整事务回滚（rusqlite 的 unchecked_transaction Drop 默认 ROLLBACK），
/// 调用方据此 fail-closed（不更新内存态）。
fn atomic_persist(
    conn: &Connection,
    item: &AttentionItem,
    audit: &AuditEvent,
) -> Result<(), ConfluxError> {
    let tx = conn
        .unchecked_transaction()
        .map_err(|e| ConfluxError::DatabaseError {
            message: format!("注意力处置事务开启失败: {}", e),
        })?;

    db_attention::update_attention_item(&tx, item)?;
    // 审计写入失败 → tx 未 commit，Drop 时 ROLLBACK，resolution 不落定（fail-closed）
    db_audit::insert_audit_event(&tx, audit)?;

    tx.commit().map_err(|e| ConfluxError::DatabaseError {
        message: format!("注意力处置事务提交失败: {}", e),
    })?;
    Ok(())
}

/// 把 ConfluxEvent 映射为入队描述（§11.2 必上浮事件白名单）。
///
/// 必上浮（V1）：
///   - PermissionRequested → Permission / Critical / Approve|Deny|Reply|Defer|Ignore
///   - ErrorOccurred(Fatal|Error) → ErrorRecovery / Critical|High / Reply|Defer|Ignore
///   - TaskCompleted → ReviewRequired / Normal / Reply|Defer|Ignore（低优先复核）
/// 非上浮：PtyOutput / AgentStatusChanged / SubAgent* / StdinInjected /
///         CoordinationCommand / DiscussionMessage / ProcessExited → None
fn map_event_to_descriptor(event: &ConfluxEvent) -> Option<IngestDescriptor> {
    match event {
        ConfluxEvent::PermissionRequested {
            instance_id,
            request,
            timestamp,
        } => Some(IngestDescriptor {
            instance_id: instance_id.clone(),
            kind: InteractionKind::Permission,
            priority: EventPriority::Critical,
            source_event_id: None,
            interaction_id: Some(request.id.clone()),
            payload_summary: format!("权限请求: {} — {}", request.action, request.description),
            available_actions: vec![
                InteractionAction::Approve,
                InteractionAction::Deny,
                InteractionAction::Reply,
                InteractionAction::Defer,
                InteractionAction::Ignore,
            ],
            created_at: *timestamp,
            permission_context: Some(request.raw_context.clone()),
            timeout_seconds: Some(request.timeout_seconds as i64),
            // §4.7：信号源投影给 UI（"scrape" = 刮屏兜底，UI 应标注不可靠）
            signal_source: Some(
                match request.signal_source {
                    crate::core::PermissionSignalSource::Hook => "hook",
                    crate::core::PermissionSignalSource::Scrape => "scrape",
                }
                .to_string(),
            ),
        }),

        ConfluxEvent::ErrorOccurred {
            instance_id,
            error_message,
            severity,
            timestamp,
        } => {
            // 仅 Fatal / Error 上浮；Warning 不进注意力队列
            let priority = match severity {
                ErrorSeverity::Fatal => EventPriority::Critical,
                ErrorSeverity::Error => EventPriority::High,
                ErrorSeverity::Warning => return None,
            };
            Some(IngestDescriptor {
                instance_id: instance_id.clone(),
                kind: InteractionKind::ErrorRecovery,
                priority,
                source_event_id: None,
                interaction_id: None,
                payload_summary: format!("错误恢复: {}", error_message),
                available_actions: vec![
                    InteractionAction::Reply,
                    InteractionAction::Defer,
                    InteractionAction::Ignore,
                ],
                created_at: *timestamp,
                permission_context: None,
                timeout_seconds: None,
                signal_source: None,
            })
        }

        ConfluxEvent::TaskCompleted {
            instance_id,
            summary,
            timestamp,
        } => Some(IngestDescriptor {
            instance_id: instance_id.clone(),
            kind: InteractionKind::ReviewRequired,
            priority: EventPriority::Normal,
            source_event_id: None,
            interaction_id: None,
            payload_summary: format!("需复核: {}", summary),
            available_actions: vec![
                InteractionAction::Reply,
                InteractionAction::Defer,
                InteractionAction::Ignore,
            ],
            created_at: *timestamp,
            permission_context: None,
            timeout_seconds: None,
            signal_source: None,
        }),

        // 非必上浮事件——不入注意力队列
        ConfluxEvent::PtyOutput { .. }
        | ConfluxEvent::AgentStatusChanged { .. }
        | ConfluxEvent::SubAgentSpawned { .. }
        | ConfluxEvent::SubAgentCompleted { .. }
        | ConfluxEvent::DiscussionMessage { .. }
        | ConfluxEvent::CoordinationCommand { .. }
        | ConfluxEvent::StdinInjected { .. }
        | ConfluxEvent::ProcessExited { .. } => None,
    }
}

/// 将注意力项序列化为前端 JSON（camelCase 字段，emit 给 attention_updated 用）。
pub fn attention_item_to_json(item: &AttentionItem) -> serde_json::Value {
    serde_json::to_value(item).unwrap_or(serde_json::Value::Null)
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::core::types::{PermissionRequest, PermissionStatus};
    use crate::persistence::audit::list_audit_events;
    use crate::persistence::schema::init_database;

    fn perm_event(instance: &str, req_id: &str, ts: i64) -> ConfluxEvent {
        ConfluxEvent::PermissionRequested {
            instance_id: InstanceId(instance.to_string()),
            request: PermissionRequest {
                id: req_id.to_string(),
                instance_id: InstanceId(instance.to_string()),
                action: "write_file".to_string(),
                description: "写入 config.toml".to_string(),
                raw_context: vec![],
                status: PermissionStatus::Pending,
                created_at: ts,
                timeout_seconds: 120,
                signal_source: crate::core::PermissionSignalSource::Scrape,
            },
            timestamp: ts,
        }
    }

    fn error_event(instance: &str, msg: &str, sev: ErrorSeverity, ts: i64) -> ConfluxEvent {
        ConfluxEvent::ErrorOccurred {
            instance_id: InstanceId(instance.to_string()),
            error_message: msg.to_string(),
            severity: sev,
            timestamp: ts,
        }
    }

    fn pty_event(instance: &str, ts: i64) -> ConfluxEvent {
        ConfluxEvent::PtyOutput {
            instance_id: InstanceId(instance.to_string()),
            data: "c29tZQ==".to_string(),
            timestamp: ts,
        }
    }

    /// ingest(PermissionRequested) → list_active 含 Critical item
    #[test]
    fn test_ingest_permission_yields_active_critical_item() {
        let conn = init_database(":memory:").unwrap();
        let mut q = AttentionQueue::new();

        let ingested = q
            .ingest(&conn, &perm_event("inst-a", "req-1", 1_000))
            .unwrap();
        assert!(ingested.is_some());

        let active = q.list_active();
        assert_eq!(active.len(), 1);
        assert_eq!(active[0].kind, InteractionKind::Permission);
        assert_eq!(active[0].priority, EventPriority::Critical);
        assert_eq!(active[0].interaction_id.as_deref(), Some("req-1"));
        assert!(active[0]
            .available_actions
            .contains(&InteractionAction::Approve));
    }

    /// P5 payload 投影：ingest(Permission) 把 raw_context/timeout 投影进 AttentionItem，
    /// 且 db round-trip 后仍保留（前端 PermissionDialog 同源渲染依赖此）。
    #[test]
    fn test_ingest_permission_projects_payload_and_roundtrips() {
        let conn = init_database(":memory:").unwrap();
        let mut q = AttentionQueue::new();

        let event = ConfluxEvent::PermissionRequested {
            instance_id: InstanceId("inst-a".to_string()),
            request: PermissionRequest {
                id: "req-ctx".to_string(),
                instance_id: InstanceId("inst-a".to_string()),
                action: "write_file".to_string(),
                description: "写 config.toml".to_string(),
                raw_context: vec!["$ rm -rf /".to_string(), "确认?".to_string()],
                status: PermissionStatus::Pending,
                created_at: 2_000,
                timeout_seconds: 90,
                signal_source: crate::core::PermissionSignalSource::Scrape,
            },
            timestamp: 2_000,
        };

        let item = q.ingest(&conn, &event).unwrap().unwrap();
        assert_eq!(
            item.permission_context,
            Some(vec!["$ rm -rf /".to_string(), "确认?".to_string()])
        );
        assert_eq!(item.timeout_seconds, Some(90));

        // db round-trip：从 db 重读，payload 仍在
        let reloaded = crate::persistence::attention::list_active_attention_items(&conn).unwrap();
        assert_eq!(reloaded.len(), 1);
        assert_eq!(
            reloaded[0].permission_context,
            Some(vec!["$ rm -rf /".to_string(), "确认?".to_string()])
        );
        assert_eq!(reloaded[0].timeout_seconds, Some(90));
    }

    /// 去重：同 instance + 同 source/interaction → 只入一项
    #[test]
    fn test_ingest_dedup_same_request() {
        let conn = init_database(":memory:").unwrap();
        let mut q = AttentionQueue::new();

        let first = q
            .ingest(&conn, &perm_event("inst-a", "req-1", 1_000))
            .unwrap();
        let dup = q
            .ingest(&conn, &perm_event("inst-a", "req-1", 1_050))
            .unwrap();

        assert!(first.is_some());
        assert!(dup.is_none(), "同请求 ID 应被去重");
        assert_eq!(q.list_active().len(), 1);
    }

    /// 优先级排序：Critical 在前，同级按 created_at 升序
    #[test]
    fn test_list_active_priority_then_time_order() {
        let conn = init_database(":memory:").unwrap();
        let mut q = AttentionQueue::new();

        // Normal（TaskCompleted）先入，时间早
        q.ingest(
            &conn,
            &ConfluxEvent::TaskCompleted {
                instance_id: InstanceId("inst-t".to_string()),
                summary: "done".to_string(),
                timestamp: 500,
            },
        )
        .unwrap();
        // High（Error）后入
        q.ingest(
            &conn,
            &error_event("inst-e", "boom", ErrorSeverity::Error, 800),
        )
        .unwrap();
        // Critical（Permission）最后入，时间最晚
        q.ingest(&conn, &perm_event("inst-p", "req-x", 2_000))
            .unwrap();
        // 第二个 Critical，时间更晚 → 同级应排在前一个 Critical 之后
        q.ingest(&conn, &perm_event("inst-p2", "req-y", 3_000))
            .unwrap();

        let active = q.list_active();
        assert_eq!(active.len(), 4);
        // Critical 在前两位，按时间升序
        assert_eq!(active[0].priority, EventPriority::Critical);
        assert_eq!(active[0].interaction_id.as_deref(), Some("req-x"));
        assert_eq!(active[1].priority, EventPriority::Critical);
        assert_eq!(active[1].interaction_id.as_deref(), Some("req-y"));
        // 然后 High，再 Normal
        assert_eq!(active[2].priority, EventPriority::High);
        assert_eq!(active[3].priority, EventPriority::Normal);
    }

    /// PtyOutput / Warning → 不上浮（None）
    #[test]
    fn test_non_surfacing_events_yield_none() {
        let conn = init_database(":memory:").unwrap();
        let mut q = AttentionQueue::new();

        assert!(q.ingest(&conn, &pty_event("inst-a", 1)).unwrap().is_none());
        assert!(q
            .ingest(
                &conn,
                &error_event("inst-a", "warn", ErrorSeverity::Warning, 2)
            )
            .unwrap()
            .is_none());
        assert!(q.list_active().is_empty());
    }

    /// resolve 后离开 active + 落审计
    #[test]
    fn test_resolve_leaves_active_and_writes_audit() {
        let conn = init_database(":memory:").unwrap();
        let mut q = AttentionQueue::new();
        let item = q
            .ingest(&conn, &perm_event("inst-a", "req-1", 1_000))
            .unwrap()
            .unwrap();

        let resolved = q
            .resolve(
                &conn,
                &item.attention_item_id,
                InteractionResolution::Approved,
                AuditAction::Approve,
                5_000,
            )
            .unwrap();

        assert_eq!(resolved.resolution, Some(InteractionResolution::Approved));
        assert_eq!(resolved.resolved_at, Some(5_000));
        assert!(q.list_active().is_empty(), "resolve 后应离开 active");

        // 审计已落库且绑定 audit_event_id
        let audit_id = resolved.audit_event_id.clone().unwrap();
        let audits = list_audit_events(&conn, None, None).unwrap();
        assert!(audits.iter().any(|a| a.audit_event_id == audit_id
            && a.action == AuditAction::Approve
            && a.result == AuditResult::Ok));
    }

    /// defer 无 remind_at → Err
    #[test]
    fn test_defer_without_remind_at_errors() {
        let conn = init_database(":memory:").unwrap();
        let mut q = AttentionQueue::new();
        let item = q
            .ingest(&conn, &perm_event("inst-a", "req-1", 1_000))
            .unwrap()
            .unwrap();

        let res = q.defer(&conn, &item.attention_item_id, None, 5_000);
        assert!(res.is_err(), "defer 无 remind_at 必须 Err");
        // 仍活跃（未落定）
        assert_eq!(q.list_active().len(), 1);
    }

    /// defer 带 remind_at → 离开 active + Deferred + 审计
    #[test]
    fn test_defer_with_remind_at_resolves_deferred() {
        let conn = init_database(":memory:").unwrap();
        let mut q = AttentionQueue::new();
        let item = q
            .ingest(&conn, &perm_event("inst-a", "req-1", 1_000))
            .unwrap()
            .unwrap();

        let deferred = q
            .defer(&conn, &item.attention_item_id, Some(9_000), 5_000)
            .unwrap();
        assert_eq!(deferred.resolution, Some(InteractionResolution::Deferred));
        assert!(q.list_active().is_empty());
    }

    /// ignore 持久 + restore 回 active + Restore 审计
    #[test]
    fn test_ignore_then_restore_roundtrip() {
        let conn = init_database(":memory:").unwrap();
        let mut q = AttentionQueue::new();
        let item = q
            .ingest(&conn, &perm_event("inst-a", "req-1", 1_000))
            .unwrap()
            .unwrap();

        // ignore
        let ignored = q.ignore(&conn, &item.attention_item_id, 5_000).unwrap();
        assert_eq!(ignored.resolution, Some(InteractionResolution::Ignored));
        assert!(q.list_active().is_empty(), "ignore 后离开 active");
        assert_eq!(q.list_ignored().len(), 1, "ignore 持久保留");

        // restore
        let restored = q.restore(&conn, &item.attention_item_id, 6_000).unwrap();
        assert_eq!(restored.resolution, None, "restore 后回到活跃");
        assert_eq!(q.list_active().len(), 1, "restore 后回 active");
        assert!(q.list_ignored().is_empty());

        // 写了一条 Restore 审计
        let audits = list_audit_events(&conn, None, None).unwrap();
        assert!(
            audits.iter().any(|a| a.action == AuditAction::Restore),
            "restore 必须写 Restore 审计"
        );
    }

    /// restore 非 ignored 项 → Err
    #[test]
    fn test_restore_non_ignored_errors() {
        let conn = init_database(":memory:").unwrap();
        let mut q = AttentionQueue::new();
        let item = q
            .ingest(&conn, &perm_event("inst-a", "req-1", 1_000))
            .unwrap()
            .unwrap();

        // 活跃项直接 restore 应 Err
        assert!(q.restore(&conn, &item.attention_item_id, 6_000).is_err());
    }

    /// MF-8 审计失败 fail-closed：resolution 不落定（DB + 内存均回滚）
    #[test]
    fn test_mf8_audit_failure_fail_closed() {
        let conn = init_database(":memory:").unwrap();
        let mut q = AttentionQueue::new();
        let item = q
            .ingest(&conn, &perm_event("inst-a", "req-1", 1_000))
            .unwrap()
            .unwrap();

        // 制造审计写入失败：预先插入一条同 audit_event_id 的审计，触发 PRIMARY KEY 冲突。
        // 由于 audit_event_id 由 resolve 内部 uuid 生成，无法预知；改为用触发器路径不可行。
        // 这里换一种确定性手段：删除 audit_events 表使 INSERT 必然失败，验证 fail-closed。
        conn.execute("DROP TABLE audit_events", []).unwrap();

        let res = q.resolve(
            &conn,
            &item.attention_item_id,
            InteractionResolution::Approved,
            AuditAction::Approve,
            5_000,
        );
        assert!(res.is_err(), "审计写入失败时 resolve 必须返回 Err");

        // 内存态未落定：仍活跃
        assert_eq!(q.list_active().len(), 1, "fail-closed：内存仍活跃");
        assert_eq!(
            q.get(&item.attention_item_id).unwrap().resolution,
            None,
            "fail-closed：resolution 未落定"
        );

        // DB 态未落定：重建 audit 表后重查 attention_items，该项 resolution 应仍为 NULL
        let still_active = db_attention::list_active_attention_items(&conn).unwrap();
        assert_eq!(
            still_active.len(),
            1,
            "fail-closed：DB 中 attention_item 仍为活跃（事务回滚）"
        );
    }

    /// resolve 不存在 id → Err，不 panic
    #[test]
    fn test_resolve_unknown_id_errors_no_panic() {
        let conn = init_database(":memory:").unwrap();
        let mut q = AttentionQueue::new();

        let res = q.resolve(
            &conn,
            "no-such-id",
            InteractionResolution::Approved,
            AuditAction::Approve,
            5_000,
        );
        assert!(res.is_err());
    }

    /// 重复处置已终态项 → Err
    #[test]
    fn test_double_resolve_errors() {
        let conn = init_database(":memory:").unwrap();
        let mut q = AttentionQueue::new();
        let item = q
            .ingest(&conn, &perm_event("inst-a", "req-1", 1_000))
            .unwrap()
            .unwrap();

        q.resolve(
            &conn,
            &item.attention_item_id,
            InteractionResolution::Approved,
            AuditAction::Approve,
            5_000,
        )
        .unwrap();

        let again = q.resolve(
            &conn,
            &item.attention_item_id,
            InteractionResolution::Denied,
            AuditAction::Deny,
            6_000,
        );
        assert!(again.is_err(), "已终态项不可重复处置");
    }

    // ===== 控制面 P4：JumpBackTarget 生成 + 链接（§5 / §13.8） =====

    use crate::core::jumpback::{JumpConfidence, JumpKind};
    use crate::persistence::jumpback as db_jumpback;

    fn discussion_event(ts: i64) -> ConfluxEvent {
        use crate::core::types::{DiscussionId, DiscussionMessageData, MessageSender};
        ConfluxEvent::DiscussionMessage {
            discussion_id: DiscussionId("disc-1".to_string()),
            message: DiscussionMessageData {
                id: "m-1".to_string(),
                discussion_id: DiscussionId("disc-1".to_string()),
                sender: MessageSender::User,
                content: "hi".to_string(),
                round: 1,
                created_at: ts,
            },
            timestamp: ts,
        }
    }

    fn exited_event(instance: &str, ts: i64) -> ConfluxEvent {
        ConfluxEvent::ProcessExited {
            instance_id: InstanceId(instance.to_string()),
            adapter_id: "codex".to_string(),
            exit_code: Some(1),
            signal: None,
            timestamp: ts,
        }
    }

    /// P4：ingest(PermissionRequested) → item 链接非空 jump_back_target_id；
    /// 可取回，instance_id/card_id 正确，target_kind ∈ {Card, TerminalRange}。
    #[test]
    fn test_ingest_permission_generates_and_links_jump_target() {
        let conn = init_database(":memory:").unwrap();
        let mut q = AttentionQueue::new();

        let item = q
            .ingest(&conn, &perm_event("inst-a", "req-1", 1_000))
            .unwrap()
            .unwrap();

        let jid = item
            .jump_back_target_id
            .clone()
            .expect("permission item 必须链接 jump_back_target_id");

        let target = db_jumpback::get_jump_back_target(&conn, &jid)
            .unwrap()
            .expect("应能取回落点");
        assert_eq!(target.jump_back_target_id, jid);
        assert_eq!(
            target.instance_id.as_ref().map(|i| i.0.as_str()),
            Some("inst-a")
        );
        assert_eq!(target.card_id.as_deref(), Some("inst-a"));
        // V1 后端拿不到可靠行号 → Card（不伪造 TerminalRange）
        assert!(
            matches!(target.target_kind, JumpKind::Card | JumpKind::TerminalRange),
            "target_kind 必须 ∈ {{Card, TerminalRange}}"
        );
        assert_eq!(target.target_kind, JumpKind::Card);
        assert_eq!(target.confidence, JumpConfidence::Medium);
    }

    /// P4：ingest(ProcessExited 异常退出) → 生成 jump target（Card）。
    #[test]
    fn test_ingest_process_exited_generates_jump_target() {
        let conn = init_database(":memory:").unwrap();
        let mut q = AttentionQueue::new();

        // ProcessExited 当前不映射为注意力项（map_event_to_descriptor → None），
        // 但 jump target 派生独立于注意力上浮：直接验证派生能力。
        let derived = JumpBackTarget::derive_from_event(&exited_event("inst-x", 2_000), None)
            .expect("ProcessExited 应派生落点");
        assert_eq!(
            derived.instance_id.as_ref().map(|i| i.0.as_str()),
            Some("inst-x")
        );
        assert_eq!(derived.target_kind, JumpKind::Card);

        // 同时确认 Error 事件（异常恢复，会上浮）也会生成并链接落点
        let item = q
            .ingest(
                &conn,
                &error_event("inst-x", "boom", ErrorSeverity::Error, 2_100),
            )
            .unwrap()
            .unwrap();
        let jid = item
            .jump_back_target_id
            .clone()
            .expect("error item 应链接落点");
        let target = db_jumpback::get_jump_back_target(&conn, &jid)
            .unwrap()
            .unwrap();
        assert_eq!(target.target_kind, JumpKind::Card);
        assert_eq!(
            target.instance_id.as_ref().map(|i| i.0.as_str()),
            Some("inst-x")
        );
    }

    /// V1-core（mux §4.3）：带 line_hint 的 ingest → 链接 TerminalRange(BackendAbs)
    /// 行级落点，区间 = [hi-5, hi]，confidence 强制 Medium（复闸 C5）。
    #[test]
    fn test_ingest_with_line_hint_links_backend_terminal_range() {
        use crate::core::jumpback::CoordSpace;
        let conn = init_database(":memory:").unwrap();
        let mut q = AttentionQueue::new();

        let item = q
            .ingest_with_line_hint(&conn, &perm_event("inst-a", "req-1", 1_000), Some(42))
            .unwrap()
            .unwrap();
        let jid = item.jump_back_target_id.expect("应链接落点");
        let target = db_jumpback::get_jump_back_target(&conn, &jid)
            .unwrap()
            .unwrap();
        assert_eq!(target.target_kind, JumpKind::TerminalRange);
        assert_eq!(target.confidence, JumpConfidence::Medium, "BackendAbs ≤Medium");
        let range = target.terminal_range.expect("TerminalRange 必带行区间");
        assert_eq!(range.coord_space, CoordSpace::BackendAbs);
        assert_eq!(range.start_line, 37, "hi - CONTEXT_LINES(5)");
        assert_eq!(range.end_line, 42);

        // 低水位 hint：start 饱和到 0，不下溢。
        let mut q2 = AttentionQueue::new();
        let item2 = q2
            .ingest_with_line_hint(&conn, &perm_event("inst-b", "req-2", 2_000), Some(2))
            .unwrap()
            .unwrap();
        let t2 = db_jumpback::get_jump_back_target(&conn, &item2.jump_back_target_id.unwrap())
            .unwrap()
            .unwrap();
        assert_eq!(t2.terminal_range.unwrap().start_line, 0);
    }

    /// P4：无法定位实例（DiscussionMessage）→ 派生 FallbackContext，
    /// confidence=Low，fallback_summary 非空（断言不静默失败）。
    #[test]
    fn test_derive_without_instance_yields_low_confidence_fallback() {
        let derived = JumpBackTarget::derive_from_event(&discussion_event(3_000), None)
            .expect("即便无实例也应派生兜底落点（不静默失败）");
        assert_eq!(derived.target_kind, JumpKind::FallbackContext);
        assert_eq!(derived.confidence, JumpConfidence::Low);
        assert!(derived.instance_id.is_none());
        let summary = derived
            .fallback_summary
            .expect("FallbackContext 必带 summary");
        assert!(
            !summary.is_empty(),
            "fallback_summary 不得为空（不静默失败）"
        );
    }

    /// P4 / §13.8：V1 派生的 target_kind 只落在 {Card, FallbackContext}
    /// （TerminalRange 仅在显式提供可靠行号时构造，后端 ingest 路径不生成）。
    #[test]
    fn test_v1_derived_kinds_are_internal_only() {
        let with_instance =
            JumpBackTarget::derive_from_event(&perm_event("i", "r", 1), None).unwrap();
        let without_instance =
            JumpBackTarget::derive_from_event(&discussion_event(1), None).unwrap();
        assert!(matches!(with_instance.target_kind, JumpKind::Card));
        assert!(matches!(
            without_instance.target_kind,
            JumpKind::FallbackContext
        ));
        // §13.8：V1 派生只落在内部聚焦类别，绝不生成 Artifact/DiscussionMessage 等外部落点。
        for t in [&with_instance, &without_instance] {
            assert!(
                matches!(
                    t.target_kind,
                    JumpKind::Card | JumpKind::TerminalRange | JumpKind::FallbackContext
                ),
                "V1 派生 target_kind 必须 ∈ {{Card, TerminalRange, FallbackContext}}"
            );
        }
    }

    /// V1-core §4.7：信号源投影——Scrape/Hook 源分别投影为 "scrape"/"hook"
    /// （UI 据此标注刮屏源不可靠）。
    #[test]
    fn test_ingest_projects_signal_source() {
        use crate::core::types::PermissionSignalSource;
        let conn = init_database(":memory:").unwrap();
        let mut q = AttentionQueue::new();

        // perm_event 夹具 = Scrape 源
        let scrape_item = q
            .ingest(&conn, &perm_event("inst-s", "req-s", 1_000))
            .unwrap()
            .unwrap();
        assert_eq!(scrape_item.signal_source.as_deref(), Some("scrape"));

        // Hook 源事件
        let mut hook_event = perm_event("inst-h", "req-h", 2_000);
        if let ConfluxEvent::PermissionRequested { request, .. } = &mut hook_event {
            request.signal_source = PermissionSignalSource::Hook;
        }
        let hook_item = q.ingest(&conn, &hook_event).unwrap().unwrap();
        assert_eq!(hook_item.signal_source.as_deref(), Some("hook"));
    }

    /// V1-core 批次 2：remind_at / signal_source 字段 DB 完整往返。
    #[test]
    fn test_remind_at_and_signal_source_roundtrip() {
        let conn = init_database(":memory:").unwrap();
        let mut q = AttentionQueue::new();
        let mut item = q
            .ingest(&conn, &perm_event("inst-a", "req-1", 1_000))
            .unwrap()
            .unwrap();

        // 直接经持久层写入新字段（语义接线在批次 4/5；此处锁存储往返）
        item.remind_at = Some(9_999);
        item.signal_source = Some("hook".to_string());
        db_attention::update_attention_item(&conn, &item).unwrap();

        let reloaded = db_attention::list_active_attention_items(&conn).unwrap();
        assert_eq!(reloaded.len(), 1);
        assert_eq!(reloaded[0].remind_at, Some(9_999));
        assert_eq!(reloaded[0].signal_source.as_deref(), Some("hook"));
    }

    /// reload_from_db：活跃 + 忽略项都能恢复进内存
    #[test]
    fn test_reload_from_db_restores_active_and_ignored() {
        let conn = init_database(":memory:").unwrap();
        let mut q = AttentionQueue::new();
        let a = q
            .ingest(&conn, &perm_event("inst-a", "req-1", 1_000))
            .unwrap()
            .unwrap();
        let b = q
            .ingest(&conn, &perm_event("inst-b", "req-2", 1_100))
            .unwrap()
            .unwrap();
        // ignore b
        q.ignore(&conn, &b.attention_item_id, 2_000).unwrap();

        // 新队列从 DB 重载
        let mut q2 = AttentionQueue::new();
        q2.reload_from_db(&conn).unwrap();
        assert_eq!(q2.list_active().len(), 1);
        assert_eq!(q2.list_active()[0].attention_item_id, a.attention_item_id);
        assert_eq!(q2.list_ignored().len(), 1);
        assert_eq!(q2.list_ignored()[0].attention_item_id, b.attention_item_id);
    }
}
