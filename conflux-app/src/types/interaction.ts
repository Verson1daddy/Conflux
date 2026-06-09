// ===== 控制面交互 / 注意力类型 =====
// 镜像后端 core/interaction.rs + orchestration/attention.rs（serde rename_all = "snake_case"）。
// 例外：EventPriority 后端无 rename_all，序列化为 PascalCase（定义见 ./agent）。
//
// P5 同源改造：前端注意力态以这些类型从后端 AttentionQueue 投影（list_attention_items
// 命令 + attention_updated 事件），取代 islandStore 的本地 pendingPermissions/notifications
// 双数组。AttentionQueue 是唯一真相源（F1 §6）。

import type { EventPriority, InstanceId } from "./agent";

/** 交互种类（对应后端 InteractionKind，snake_case）。 */
export type InteractionKind =
  | "permission"
  | "needs_input"
  | "plan_review"
  | "tool_approval"
  | "error_recovery"
  | "review_required";

/** 用户对交互可执行的动作（对应后端 InteractionAction，snake_case）。 */
export type InteractionAction =
  | "approve"
  | "deny"
  | "reply"
  | "jump"
  | "defer"
  | "ignore";

/** 交互最终处置结果（对应后端 InteractionResolution，snake_case）。 */
export type InteractionResolution =
  | "approved"
  | "denied"
  | "replied"
  | "deferred"
  | "ignored"
  | "expired";

/**
 * 前端 resolve 时可指定的处置语义（白名单，对应后端 ResolveKind）。
 * MF-6：前端只能在此受限集合里选；审计 actor/action 由后端命令边界硬编码。
 */
export type ResolveKind = "approve" | "deny" | "reply";

/**
 * 后端 owned AttentionQueue 的一项（对应 orchestration/attention.rs::AttentionItem，snake_case）。
 * `resolution === null` 表示活跃（待处理）；非 null 表示已处置。
 * 前端**不维护**此状态，仅投影后端快照（F1 §6 同源约束）。
 */
export interface AttentionItem {
  attention_item_id: string;
  instance_id: InstanceId;
  kind: InteractionKind;
  priority: EventPriority;
  source_event_id: string | null;
  interaction_id: string | null;
  payload_summary: string;
  available_actions: InteractionAction[];
  jump_back_target_id: string | null;
  created_at: number;
  resolved_at: number | null;
  resolution: InteractionResolution | null;
  audit_event_id: string | null;
  /** 权限请求原始上下文（仅 kind=permission；来自 PermissionRequest.raw_context） */
  permission_context: string[] | null;
  /** 权限超时秒数（仅 kind=permission） */
  timeout_seconds: number | null;
}
