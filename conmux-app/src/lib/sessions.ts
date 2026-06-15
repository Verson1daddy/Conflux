// ===== conmux 会话 store（M④ 多会话缩点）=====
//
// 会话数据属主 = 后端 conmux-app（per-pane 注册表）。经 Tauri 命令拉取/变更：
//   list_sessions() -> SessionInfo[]    （启动构建缩点条）
//   create_session(program?) -> SessionInfo  （「+」新建：powershell 默认 D-2）
//   kill_session(instanceId) -> void     （active pill hover 出的 × 关闭）
//
// store 持有 list + activeId（useSyncExternalStore 广播驱动 TopBar / App 重渲染）。
//   - init：list_sessions → set active = 第一个（后端已稳定排序，default 优先）。
//   - create：Spawn 成功 → 加入 list + setActive 新会话。
//   - remove(kill)：kill_session → 移除 + active 顺延（移除的是 active 时切到邻居）。
//
// body mount-all（D-1）：App 据 list 渲一个 XtermTerminal/会话，CSS 仅显 active——
// 保 live 终端态、切换零重连。各 instanceId = session.instanceId（真实 daemon pane）。

import { invoke } from "@tauri-apps/api/core";

/** 后端 SessionInfo 镜像（serde snake_case）。 */
export interface SessionInfo {
  instance_id: string;
  adapter_id: string;
  exited: boolean;
}

/** store 内的会话条目（前端视角；name 派生展示用）。 */
export interface SessionEntry {
  instanceId: string;
  adapterId: string;
  /** 缩点条 pill 展示名。默认会话显 "conmux"，其余显短 id。 */
  name: string;
}

let sessions: SessionEntry[] = [];
let activeId: string | null = null;
const listeners = new Set<() => void>();

/** 默认会话 paneId（后端 DEFAULT_PANE_ID）；用于派生展示名。 */
const DEFAULT_PANE_ID = "conmux-default";

function notify(): void {
  for (const cb of listeners) cb();
}

/** 由 instanceId 派生缩点条展示名（默认会话 = "conmux"，其余取序号后缀）。 */
function deriveName(instanceId: string): string {
  if (instanceId === DEFAULT_PANE_ID) return "conmux";
  // "conmux-3" → "3"；非预期形态回退原 id。
  const m = /^conmux-(.+)$/.exec(instanceId);
  return m ? m[1] : instanceId;
}

function toEntry(info: SessionInfo): SessionEntry {
  return {
    instanceId: info.instance_id,
    adapterId: info.adapter_id,
    name: deriveName(info.instance_id),
  };
}

// ===== 读取 =====

export function getSessions(): SessionEntry[] {
  return sessions;
}

export function getActiveId(): string | null {
  return activeId;
}

// ===== useSyncExternalStore 接口 =====

export function subscribeSessions(cb: () => void): () => void {
  listeners.add(cb);
  return () => {
    listeners.delete(cb);
  };
}

// ===== 变更 =====

/** 设当前活跃会话（click 缩点项）。无该会话则忽略。 */
export function setActive(instanceId: string): void {
  if (instanceId === activeId) return;
  if (!sessions.some((s) => s.instanceId === instanceId)) return;
  activeId = instanceId;
  notify();
}

/**
 * 启动拉取（list_sessions → 构建 list + active = 第一个）。
 * 后端不可用（降级态 / 非 Windows）则保持空列表（不抛，缩点条空但不崩）。
 */
export async function initSessions(): Promise<void> {
  try {
    const list = await invoke<SessionInfo[]>("list_sessions");
    sessions = list.map(toEntry);
    activeId = sessions.length > 0 ? sessions[0].instanceId : null;
    notify();
  } catch {
    // 后端不可用——空列表（不阻塞 GUI；缩点条显空，body 无终端）。
    sessions = [];
    activeId = null;
    notify();
  }
}

/**
 * 新建会话（「+」按钮）：create_session(program) → 加入 list + setActive 新会话。
 * 失败抛出（调用方可降级处理，如 toast）；store 不变。
 */
export async function createSession(program?: string): Promise<SessionEntry> {
  const info = await invoke<SessionInfo>("create_session", {
    program: program ?? null,
  });
  const entry = toEntry(info);
  // 去重插入（后端 paneId 自增不应碰撞，仍防御）。
  if (!sessions.some((s) => s.instanceId === entry.instanceId)) {
    sessions = [...sessions, entry];
  }
  activeId = entry.instanceId;
  notify();
  return entry;
}

/**
 * 关闭会话（active pill 的 ×）：kill_session(instanceId) → 移除 + active 顺延。
 * 即便后端 kill 报错也清本地（与后端 kill_session 的"失败仍清表"对齐）。
 */
export async function removeSession(instanceId: string): Promise<void> {
  try {
    await invoke<void>("kill_session", { instanceId });
  } catch {
    // 后端报错也清本地（避免僵尸缩点项；后端同样已清其表项）。
  }
  const idx = sessions.findIndex((s) => s.instanceId === instanceId);
  if (idx === -1) return;
  const wasActive = activeId === instanceId;
  sessions = sessions.filter((s) => s.instanceId !== instanceId);
  if (wasActive) {
    // active 顺延：优先取被移除位置的邻居（前一个），否则第一个，空则 null。
    const next = sessions[Math.max(0, idx - 1)] ?? sessions[0] ?? null;
    activeId = next ? next.instanceId : null;
  }
  notify();
}
