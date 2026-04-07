// ===== Tauri IPC 调用封装 =====
// 所有 Tauri command 的 TypeScript 封装函数
// 使用 @tauri-apps/api/core 的 invoke() 调用后端命令
// 每个函数对应一个 #[tauri::command] Rust 函数
// 返回值类型与 Rust 返回类型一一对应

import { invoke } from "@tauri-apps/api/core";
import type {
  InstanceId,
  AdapterId,
  DiscussionId,
  AgentInstanceInfo,
  AgentStateDetail,
  AgentTree,
  AdapterInfo,
  AdapterConfig,
  DiscussionSession,
  DiscussionMessage,
  DiscussionSummary,
  SessionSummary,
  SessionEvent,
  WorkspaceLayout,
  IslandMode,
  InjectionSource,
  PermissionDecision,
} from "../types";

// ===== Agent 实例管理 =====
// 对应 Rust commands/agent.rs

/**
 * 创建 Agent 实例 — 根据 adapter_id 启动一个新 PTY 进程
 * 对应 Rust: create_agent_instance(adapter_id, working_dir, args)
 */
export async function createAgentInstance(
  adapterId: AdapterId,
  workingDir?: string,
  args?: string[]
): Promise<AgentInstanceInfo> {
  return invoke<AgentInstanceInfo>("create_agent_instance", {
    adapter_id: adapterId,
    working_dir: workingDir ?? null,
    args: args ?? null,
  });
}

/**
 * 销毁 Agent 实例 — 终止 PTY 进程并清理资源
 * 对应 Rust: destroy_agent_instance(instance_id)
 */
export async function destroyAgentInstance(
  instanceId: InstanceId
): Promise<void> {
  return invoke<void>("destroy_agent_instance", {
    instance_id: instanceId,
  });
}

/**
 * 列出所有活跃 Agent 实例
 * 对应 Rust: list_agent_instances()
 */
export async function listAgentInstances(): Promise<AgentInstanceInfo[]> {
  return invoke<AgentInstanceInfo[]>("list_agent_instances");
}

/**
 * 查询单个 Agent 实例的详细状态
 * 对应 Rust: get_agent_state(instance_id)
 */
export async function getAgentState(
  instanceId: InstanceId
): Promise<AgentStateDetail> {
  return invoke<AgentStateDetail>("get_agent_state", {
    instance_id: instanceId,
  });
}

/**
 * 获取 Agent 的 sub-agent 树
 * 对应 Rust: get_agent_tree(instance_id)
 */
export async function getAgentTree(instanceId: InstanceId): Promise<AgentTree> {
  return invoke<AgentTree>("get_agent_tree", {
    instance_id: instanceId,
  });
}

// ===== PTY 操作 =====
// 对应 Rust commands/agent.rs（PTY 部分）

/**
 * 向 Agent 实例的 stdin 注入内容
 * 附录 B1: 必须附带 InjectionSource 来源标识
 * 对应 Rust: inject_stdin(instance_id, input, source)
 */
export async function injectStdin(
  instanceId: InstanceId,
  input: string,
  source: InjectionSource
): Promise<void> {
  return invoke<void>("inject_stdin", {
    instance_id: instanceId,
    input,
    source,
  });
}

/**
 * 调整 PTY 终端尺寸
 * 对应 Rust: resize_pty(instance_id, cols, rows)
 */
export async function resizePty(
  instanceId: InstanceId,
  cols: number,
  rows: number
): Promise<void> {
  return invoke<void>("resize_pty", {
    instance_id: instanceId,
    cols,
    rows,
  });
}

// ===== 适配器管理 =====
// 对应 Rust commands/adapter.rs

/**
 * 列出所有已注册的适配器
 * 对应 Rust: list_adapters()
 */
export async function listAdapters(): Promise<AdapterInfo[]> {
  return invoke<AdapterInfo[]>("list_adapters");
}

/**
 * 注册自定义适配器（从 TOML 配置路径）
 * 对应 Rust: register_adapter(config_path)
 */
export async function registerAdapter(configPath: string): Promise<AdapterId> {
  return invoke<AdapterId>("register_adapter", {
    config_path: configPath,
  });
}

/**
 * 获取单个适配器的详细配置
 * 对应 Rust: get_adapter_config(adapter_id)
 */
export async function getAdapterConfig(
  adapterId: AdapterId
): Promise<AdapterConfig> {
  return invoke<AdapterConfig>("get_adapter_config", {
    adapter_id: adapterId,
  });
}

/**
 * 移除自定义适配器
 * 对应 Rust: unregister_adapter(adapter_id)
 */
export async function unregisterAdapter(
  adapterId: AdapterId
): Promise<void> {
  return invoke<void>("unregister_adapter", {
    adapter_id: adapterId,
  });
}

// ===== 编排操作 =====
// 对应 Rust commands/orchestration.rs

/**
 * 发起跨 Agent 讨论
 * 对应 Rust: start_discussion(topic, participant_ids, max_rounds)
 */
export async function startDiscussion(
  topic: string,
  participantIds: InstanceId[],
  maxRounds?: number
): Promise<DiscussionSession> {
  return invoke<DiscussionSession>("start_discussion", {
    topic,
    participant_ids: participantIds,
    max_rounds: maxRounds ?? null,
  });
}

/**
 * 用户在讨论中发送消息
 * 对应 Rust: send_discussion_message(discussion_id, content)
 */
export async function sendDiscussionMessage(
  discussionId: DiscussionId,
  content: string
): Promise<DiscussionMessage> {
  return invoke<DiscussionMessage>("send_discussion_message", {
    discussion_id: discussionId,
    content,
  });
}

/**
 * 结束讨论
 * 对应 Rust: end_discussion(discussion_id)
 */
export async function endDiscussion(
  discussionId: DiscussionId
): Promise<DiscussionSummary> {
  return invoke<DiscussionSummary>("end_discussion", {
    discussion_id: discussionId,
  });
}

/**
 * 设置灵动岛主框架
 * 对应 Rust: set_primary_framework(instance_id)
 */
export async function setPrimaryFramework(
  instanceId: InstanceId
): Promise<void> {
  return invoke<void>("set_primary_framework", {
    instance_id: instanceId,
  });
}

/**
 * 获取当前灵动岛主框架
 * 对应 Rust: get_primary_framework()
 */
export async function getPrimaryFramework(): Promise<InstanceId | null> {
  return invoke<InstanceId | null>("get_primary_framework");
}

// ===== 持久化操作 =====
// 对应 Rust commands/persistence.rs

/**
 * 获取会话列表（分页）
 * 对应 Rust: list_sessions(limit, offset)
 */
export async function listSessions(
  limit?: number,
  offset?: number
): Promise<SessionSummary[]> {
  return invoke<SessionSummary[]>("list_sessions", {
    limit: limit ?? null,
    offset: offset ?? null,
  });
}

/**
 * 查询指定实例的事件流（用于回放）
 * 对应 Rust: query_session_events(instance_id, from_ts, to_ts, limit)
 */
export async function querySessionEvents(
  instanceId: InstanceId,
  fromTs?: number,
  toTs?: number,
  limit?: number
): Promise<SessionEvent[]> {
  return invoke<SessionEvent[]>("query_session_events", {
    instance_id: instanceId,
    from_ts: fromTs ?? null,
    to_ts: toTs ?? null,
    limit: limit ?? null,
  });
}

/**
 * 查询讨论记录列表
 * 对应 Rust: list_discussions(limit, offset)
 */
export async function listDiscussions(
  limit?: number,
  offset?: number
): Promise<DiscussionSession[]> {
  return invoke<DiscussionSession[]>("list_discussions", {
    limit: limit ?? null,
    offset: offset ?? null,
  });
}

/**
 * 查询讨论消息历史
 * 对应 Rust: get_discussion_messages(discussion_id)
 */
export async function getDiscussionMessages(
  discussionId: DiscussionId
): Promise<DiscussionMessage[]> {
  return invoke<DiscussionMessage[]>("get_discussion_messages", {
    discussion_id: discussionId,
  });
}

/**
 * 保存工作台布局
 * 对应 Rust: save_workspace_layout(layout)
 */
export async function saveWorkspaceLayout(
  layout: WorkspaceLayout
): Promise<void> {
  return invoke<void>("save_workspace_layout", {
    layout,
  });
}

/**
 * 加载工作台布局
 * 对应 Rust: load_workspace_layout()
 */
export async function loadWorkspaceLayout(): Promise<WorkspaceLayout | null> {
  return invoke<WorkspaceLayout | null>("load_workspace_layout");
}

// ===== 窗口管理 =====
// 对应 Rust commands/window.rs

/**
 * 打开工作台窗口
 * 对应 Rust: open_workspace_window(app)
 * 注意：Tauri 自动注入 AppHandle，前端不需要传
 */
export async function openWorkspaceWindow(): Promise<void> {
  return invoke<void>("open_workspace_window");
}

/**
 * 聚焦到指定 Agent 卡片
 * 对应 Rust: focus_agent_card(instance_id)
 */
export async function focusAgentCard(instanceId: InstanceId): Promise<void> {
  return invoke<void>("focus_agent_card", {
    instance_id: instanceId,
  });
}

/**
 * 切换灵动岛模式
 * 对应 Rust: switch_island_mode(app, mode)
 * 注意：Tauri 自动注入 AppHandle，前端不需要传
 */
export async function switchIslandMode(mode: IslandMode): Promise<void> {
  return invoke<void>("switch_island_mode", {
    mode,
  });
}

/**
 * 获取当前灵动岛模式
 * 对应 Rust: get_island_mode()
 */
export async function getIslandMode(): Promise<IslandMode> {
  return invoke<IslandMode>("get_island_mode");
}

// ===== 权限响应（附录 B3） =====

/**
 * 响应权限请求（附录 B3——修复 HIGH-04）
 * 对应 Rust: respond_to_permission(permission_id, decision)
 */
export async function respondToPermission(
  permissionId: string,
  decision: PermissionDecision
): Promise<void> {
  return invoke<void>("respond_to_permission", {
    permission_id: permissionId,
    decision,
  });
}
