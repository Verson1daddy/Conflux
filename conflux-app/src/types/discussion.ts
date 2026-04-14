// ===== 讨论相关类型 =====
// 对应 Rust 端 src-tauri/src/core/types.rs 中的讨论相关结构体

import type { InstanceId, DiscussionId } from "./agent";

// ===== 讨论状态 =====

/**
 * 讨论会话状态枚举
 * 对应 Rust DiscussionStatus，serde rename_all = "snake_case"
 */
export type DiscussionStatus = "active" | "completed" | "cancelled";

// ===== 讨论会话 =====

/**
 * 讨论会话
 * 对应 Rust DiscussionSession
 */
export interface DiscussionSession {
  /** 讨论 ID */
  id: DiscussionId;
  /** 讨论主题 */
  topic: string;
  /** 参与者实例 ID 列表（工作台实例，作为 adapter 参考源） */
  participant_ids: InstanceId[];
  /** 讨论专用隐藏 sandbox 实例 ID（消息注入目标） */
  sandbox_instance_ids: InstanceId[];
  /** 最大讨论轮次 */
  max_rounds: number;
  /** 当前轮次 */
  current_round: number;
  /** 讨论状态 */
  status: DiscussionStatus;
  /** 创建时间（Unix 时间戳 ms） */
  created_at: number;
  /** 结束时间（Unix 时间戳 ms），null 表示尚未结束 */
  ended_at: number | null;
}

// ===== 讨论消息 =====

/**
 * 消息发送者
 * 对应 Rust MessageSender，serde(tag = "type", content = "value")
 */
export type MessageSender =
  | { type: "User" }
  | { type: "Agent"; value: InstanceId }
  | { type: "System" };

/**
 * 讨论消息数据
 * 对应 Rust DiscussionMessageData
 */
export interface DiscussionMessageData {
  /** 消息 ID */
  id: string;
  /** 所属讨论 ID */
  discussion_id: DiscussionId;
  /** 消息发送者 */
  sender: MessageSender;
  /** 消息内容 */
  content: string;
  /** 消息所在轮次 */
  round: number;
  /** 创建时间（Unix 时间戳 ms） */
  created_at: number;
}

/**
 * 讨论消息（Tauri command 返回类型）
 * 与 DiscussionMessageData 结构一致
 */
export type DiscussionMessage = DiscussionMessageData;

// ===== 讨论摘要 =====

/**
 * 讨论结束摘要
 * 对应 Rust DiscussionSummary
 */
export interface DiscussionSummary {
  /** 讨论 ID */
  discussion_id: DiscussionId;
  /** 讨论主题 */
  topic: string;
  /** 总讨论轮次 */
  total_rounds: number;
  /** 摘要文本 */
  summary_text: string;
  /** 结束时间（Unix 时间戳 ms） */
  ended_at: number;
}
