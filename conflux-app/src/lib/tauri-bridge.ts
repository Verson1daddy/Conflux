// ===== Tauri IPC 调用封装 =====
// 所有 Tauri command 的 TypeScript 封装函数
// 使用 @tauri-apps/api/core 的 invoke() 调用后端命令
// 每个函数对应一个 #[tauri::command] Rust 函数
// 返回值类型与 Rust 返回类型一一对应
//
// IMPORTANT — Tauri v2 参数命名约定：
//   Rust 侧的参数名是 snake_case（例：`adapter_id: AdapterId`），
//   前端调 invoke 时必须用 **camelCase**（例：`adapterId`）。
//   Tauri 自动把 camelCase 反向 map 到 snake_case。
//   如果前端直接传 snake_case，Tauri 报 "missing required key adapterId"，
//   因为它在参数对象里找不到 camelCase 的预期 key。
//   所有带参数的 invoke 在这个文件里都用 camelCase。

import { invoke } from "@tauri-apps/api/core";
import type {
  InstanceId,
  AdapterId,
  DiscussionId,
  AgentMode,
  AgentInstanceInfo,
  AgentStateDetail,
  AgentTree,
  AdapterInfo,
  AdapterAuthStatus,
  AdapterConfig,
  DiscussionSession,
  DiscussionMessage,
  DiscussionSummary,
  SessionSummary,
  SessionEvent,
  WorkspaceLayout,
  AutoPackConfig,
  IslandMode,
  PermissionDecision,
  AttentionItem,
  ResolveKind,
} from "../types";

// ===== Agent 实例管理 =====
// 对应 Rust commands/agent.rs

/**
 * 创建 Agent 实例 — 根据 adapter_id 启动一个新 PTY 进程
 * 对应 Rust: create_agent_instance(adapter_id, working_dir, args)
 */
export async function getDefaultWorkingDir(): Promise<string> {
  return invoke<string>("get_default_working_dir");
}

export async function createAgentInstance(
  adapterId: AdapterId,
  workingDir?: string,
  args?: string[],
  displayName?: string
): Promise<AgentInstanceInfo> {
  return invoke<AgentInstanceInfo>("create_agent_instance", {
    adapterId,
    workingDir: workingDir ?? null,
    args: args ?? null,
    displayName: displayName ?? null,
  });
}

/**
 * 重命名 Agent 实例（设置用户自定义别名）
 * 对应 Rust: rename_agent_instance(instance_id, display_name)
 */
export async function renameAgentInstance(
  instanceId: InstanceId,
  displayName: string | null
): Promise<void> {
  return invoke<void>("rename_agent_instance", {
    instanceId,
    displayName,
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
    instanceId,
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
    instanceId,
  });
}

/**
 * 获取 Agent 的 sub-agent 树
 * 对应 Rust: get_agent_tree(instance_id)
 */
export async function getAgentTree(instanceId: InstanceId): Promise<AgentTree> {
  return invoke<AgentTree>("get_agent_tree", {
    instanceId,
  });
}

/**
 * 拉取 PTY 实例的 OutputBuffer 历史（base64 编码）
 *
 * 让刚 mount 的 xterm 能重放已经被后端捕获的历史输出，避免预览卡片和
 * 展开态的内容不同步（expanded 态挂得比卡片晚，若不拉历史就永远看不到
 * mount 前到达的 PTY chunks）。
 * 对应 Rust: get_pty_history(instance_id) -> String (base64)
 */
export async function getPtyHistory(
  instanceId: InstanceId
): Promise<string> {
  return invoke<string>("get_pty_history", {
    instanceId,
  });
}

/**
 * C2-T1 备用 exit 检测 · 轮询 fallback
 *
 * Windows ConPTY 在 child exit 后 reader 有时不返回 EOF，导致
 * ProcessExited 事件永远不 emit。前端用 ~2s 间隔调此命令检查。
 * 对应 Rust: is_process_exited(instance_id) -> bool
 */
export async function isProcessExited(
  instanceId: InstanceId
): Promise<boolean> {
  return invoke<boolean>("is_process_exited", {
    instanceId,
  });
}

/**
 * C2-T1 Exit Overlay · Respawn 模式枚举（对应 Rust RespawnMode）
 *
 * - `restart`: 用原 adapter_id 重启同一种 agent（例如 claude 退出后再启一个 claude）
 * - `shell`:   切换到 powershell（Windows）/ bash（未来平台），保留同一 instance_id
 */
export type RespawnMode = "restart" | "shell";

/**
 * C2-T1 Exit Overlay · 重启 Agent 或切换到 Shell（复用 instance_id）
 *
 * 用于 ExitOverlay 的 Restart / Open Shell 两个按钮。成功后卡片在前端
 * 原地复活，不需要 add/remove card。
 *
 * 对应 Rust: respawn_agent_instance(instance_id, mode) -> AgentInstanceInfo
 */
export async function respawnAgentInstance(
  instanceId: InstanceId,
  mode: RespawnMode
): Promise<AgentInstanceInfo> {
  return invoke<AgentInstanceInfo>("respawn_agent_instance", {
    instanceId,
    mode,
  });
}

/**
 * 切换运行中 Agent 实例的权限模式
 * WARNING: 这会 kill 并重启 agent 进程，当前会话上下文将丢失。
 * 对应 Rust: set_agent_mode(instance_id, mode) -> AgentInstanceInfo
 */
export async function setAgentMode(
  instanceId: InstanceId,
  mode: AgentMode
): Promise<AgentInstanceInfo> {
  return invoke<AgentInstanceInfo>("set_agent_mode", {
    instanceId,
    mode,
  });
}

// ===== PTY 操作 =====
// 对应 Rust commands/agent.rs（PTY 部分）

/**
 * 向 Agent 实例的 stdin 注入内容——用户直接输入通道。
 * MF-2: 注入源由后端固定为 UserDirect，前端不再传 source（防自标特权源）。
 * 对应 Rust: inject_stdin(instance_id, input)
 */
export async function injectStdin(
  instanceId: InstanceId,
  input: string
): Promise<void> {
  return invoke<void>("inject_stdin", {
    instanceId,
    input,
  });
}

/**
 * 讨论消息注入——讨论用户消息通道。
 * MF-2: 注入源由后端固定为 DiscussionUserMessage，前端不再传 source。
 * 对应 Rust: inject_discussion_message(instance_id, input)
 */
export async function injectDiscussionMessage(
  instanceId: InstanceId,
  input: string
): Promise<void> {
  return invoke<void>("inject_discussion_message", {
    instanceId,
    input,
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
    instanceId,
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
    configPath,
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
    adapterId,
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
    adapterId,
  });
}

/**
 * 检测指定适配器的认证/登录状态
 * 对应 Rust: detect_adapter_auth(adapter_id) -> AdapterAuthStatus
 */
export async function detectAdapterAuth(
  adapterId: AdapterId
): Promise<AdapterAuthStatus> {
  return invoke<AdapterAuthStatus>("detect_adapter_auth", {
    adapterId,
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
    participantIds,
    maxRounds: maxRounds ?? null,
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
    discussionId,
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
    discussionId,
  });
}

/**
 * 切换实例钉选状态（多选）
 * 对应 Rust: toggle_pin_instance(instance_id)
 * @returns 切换后该实例是否处于钉选状态
 */
export async function togglePinInstance(
  instanceId: InstanceId
): Promise<boolean> {
  return invoke<boolean>("toggle_pin_instance", {
    instanceId,
  });
}

/**
 * 获取所有钉选实例 ID 列表
 * 对应 Rust: get_pinned_instances()
 */
export async function getPinnedInstances(): Promise<InstanceId[]> {
  return invoke<InstanceId[]>("get_pinned_instances");
}

// ===== Adapter 偏好操作 =====
// 对应 Rust commands/adapter.rs

export async function setFavoriteAdapters(
  adapterIds: string[]
): Promise<void> {
  return invoke<void>("set_favorite_adapters", { adapterIds });
}

export async function getFavoriteAdapters(): Promise<string[]> {
  return invoke<string[]>("get_favorite_adapters");
}

export async function setPrimaryAdapterBackend(
  adapterId: string
): Promise<void> {
  return invoke<void>("set_primary_adapter", { adapterId });
}

export async function getPrimaryAdapterBackend(): Promise<string | null> {
  return invoke<string | null>("get_primary_adapter");
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
    instanceId,
    fromTs: fromTs ?? null,
    toTs: toTs ?? null,
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
    discussionId,
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

/**
 * 触发 AutoPack 重排——根据配置重新计算所有卡片位置和尺寸
 * 对应 Rust: auto_pack_layout(config)
 */
export async function autoPackLayout(
  config: AutoPackConfig
): Promise<WorkspaceLayout> {
  return invoke<WorkspaceLayout>("auto_pack_layout", {
    config,
  });
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
    instanceId,
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

export async function showIslandWindow(): Promise<void> {
  return invoke<void>("show_island_window");
}

export async function showWorkspaceOnly(): Promise<void> {
  return invoke<void>("show_workspace_only");
}

export async function showCompactModeOnly(mode: IslandMode): Promise<void> {
  return invoke<void>("show_compact_mode_only", {
    mode,
  });
}

export async function setIslandDetailPresentation(
  detail:
    | "none"
    | "top_island_expanded"
    | "top_island_popover"
    | "sidebar_expanded"
    | "sidebar_floating",
  mode?: IslandMode
): Promise<void> {
  const args: {
    detail:
      | "none"
      | "top_island_expanded"
      | "top_island_popover"
      | "sidebar_expanded"
      | "sidebar_floating";
    mode?: IslandMode;
  } = { detail };

  if (mode) {
    args.mode = mode;
  }

  return invoke<void>("set_island_detail_presentation", args);
}

export async function setTopIslandPopoverHeight(height: number): Promise<void> {
  return invoke<void>("set_top_island_popover_height", {
    height,
  });
}

export async function markIslandWindowReady(): Promise<void> {
  return invoke<void>("mark_island_window_ready");
}

export interface IslandWindowGeometrySnapshot {
  mode: IslandMode;
  detail: string;
  detail_presentation: string;
  pending_compact_show: boolean;
  island_window_ready: boolean;
  window_exists: boolean;
  visible: boolean | null;
  app_monitor: {
    width: number;
    height: number;
    origin_x: number;
    origin_y: number;
  };
  window_monitor: {
    width: number;
    height: number;
    origin_x: number;
    origin_y: number;
  } | null;
  expected_config: {
    width: number;
    height: number;
    placement: string;
    always_on_top: boolean;
  };
  expected_geometry: {
    x: number;
    y: number;
    width: number;
    height: number;
  };
  actual_outer_position_physical: {
    x: number;
    y: number;
  } | null;
  actual_outer_size_physical: {
    width: number;
    height: number;
  } | null;
  actual_inner_size_physical: {
    width: number;
    height: number;
  } | null;
}

export async function debugIslandWindowGeometry(): Promise<IslandWindowGeometrySnapshot> {
  return invoke<IslandWindowGeometrySnapshot>("debug_island_window_geometry");
}

export async function hideIslandWindow(): Promise<void> {
  return invoke<void>("hide_island_window");
}

/**
 * 真正退出整个应用进程，而不是只销毁当前窗口。
 * 对应 Rust: quit_application()
 */
export async function quitApplication(): Promise<void> {
  return invoke<void>("quit_application");
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
 * 对应 Rust: respond_to_permission(instance_id, permission_id, decision)
 *
 * B3 修复：新增 instanceId 参数，显式指定目标实例，
 * 避免后端通过遍历 waiting_permission 状态来猜测目标。
 * 当多个 agent 同时等待权限时，不传 instanceId 会导致审批错乱。
 */
export async function respondToPermission(
  instanceId: InstanceId,
  permissionId: string,
  decision: PermissionDecision
): Promise<void> {
  return invoke<void>("respond_to_permission", {
    instanceId,
    permissionId,
    decision,
  });
}

// ===== 注意力队列（控制面 P5 · 对应 commands/attention.rs） =====
// 同源真相源：list 返回全部活跃项，前端自行按 kind 过滤；resolve/defer/ignore/restore
// 处置后后端 emit attention_updated，前端经 onAttentionUpdated 收全量快照。

/** 列出当前活跃的注意力项（后端按优先级 + 时间排序）。 */
export async function listAttentionItems(): Promise<AttentionItem[]> {
  return invoke<AttentionItem[]>("list_attention_items");
}

/** 处置一条注意力项（approve / deny / reply）。actor/action 由后端硬编码（MF-6）。 */
export async function resolveAttentionItem(
  attentionItemId: string,
  kind: ResolveKind
): Promise<AttentionItem> {
  return invoke<AttentionItem>("resolve_attention_item", {
    attentionItemId,
    kind,
  });
}

/** 延后一条注意力项（必须带 remindAt，缺失后端返回 Err）。 */
export async function deferAttentionItem(
  attentionItemId: string,
  remindAt: number
): Promise<AttentionItem> {
  return invoke<AttentionItem>("defer_attention_item", {
    attentionItemId,
    remindAt,
  });
}

/** 忽略一条注意力项（持久保留，可 restore）。 */
export async function ignoreAttentionItem(
  attentionItemId: string
): Promise<AttentionItem> {
  return invoke<AttentionItem>("ignore_attention_item", { attentionItemId });
}

/** 恢复一条被忽略的注意力项（回到活跃）。 */
export async function restoreAttentionItem(
  attentionItemId: string
): Promise<AttentionItem> {
  return invoke<AttentionItem>("restore_attention_item", { attentionItemId });
}
