// ===== conmux 会话 store（M④ 多会话缩点 → M⑤b 启动名 + RECENT）=====
//
// 会话数据属主 = 后端 conmux-app（per-pane 注册表）。经 Tauri 命令拉取/变更：
//   list_sessions() -> SessionInfo[]    （启动构建缩点条）
//   create_session(program?,args?,cwd?) -> SessionInfo  （「+」/快捷启动）
//   kill_session(instanceId) -> void     （active pill hover 出的 × 关闭）
//
// store 持有 list + activeId（useSyncExternalStore 广播驱动 TopBar / App 重渲染）。
//   - init：list_sessions → set active = 第一个（后端已稳定排序，default 优先）。
//   - create：Spawn 成功 → 加入 list + setActive 新会话。
//   - remove(kill)：kill_session → 移除 + active 顺延（移除的是 active 时切到邻居）。
//
// body mount-all（D-1）：App 据 list 渲一个 XtermTerminal/会话，CSS 仅显 active——
// 保 live 终端态、切换零重连。各 instanceId = session.instanceId（真实 daemon pane）。
//
// M⑤b 演进：
//   - createSession 改签名收 spec{name?,program?,args?,cwd?}（兼容旧无参 = 默认 powershell）；
//     快捷启动的会话携带 launchName（缩点条/Home 显其名）+ launchCommand（RECENT 重开用）。
//   - removeSession 时若有 launchCommand → push 到 RECENT store（localStorage，最近优先、capped）。

import { invoke } from "@tauri-apps/api/core";
import { parseCommand } from "./launch-registry";

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
  /** 启动项名（快捷启动携带；缩点条/Home 显示优先用它，D-3）。默认会话无。 */
  launchName?: string;
  /** 启动命令原文（RECENT 重开用，D-3）。默认会话无。 */
  launchCommand?: string;
  /** 启动工作目录（spec.cwd）；无则继承当前目录。 */
  cwd?: string;
}

/** RECENT 条目（最近关闭的可重开会话）。 */
export interface RecentEntry {
  /** 展示名（= 该会话 launchName）。 */
  name: string;
  /** 启动命令原文（reopen 时 parse → create_session）。 */
  command: string;
  /** 工作目录（可选）。 */
  cwd?: string;
  /** 关闭时间戳（ms，UI 侧生成；最近优先 + "Nm ago"）。 */
  closedAt: number;
}

let sessions: SessionEntry[] = [];
let activeId: string | null = null;
/**
 * daemon 控制连接态（M⑤h 真信号）：启动 invoke `is_daemon_connected` 拉一次后写入。
 * 拉失败 / 非 Windows → false（降级，不崩）。比 `sessions.length>0` 代理诚实——
 * 0 会话时 daemon 仍在跑（control 连接独立于会话），点应亮。
 */
let daemonConnected = false;
const listeners = new Set<() => void>();

/** 默认会话 paneId（后端 DEFAULT_PANE_ID）；用于派生展示名。 */
const DEFAULT_PANE_ID = "conmux-default";

/** RECENT 持久化 key + 容量上限。 */
const RECENT_KEY = "conmux.recentSessions";
const RECENT_CAP = 8;

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

/** daemon 控制连接态（真信号；启动 initDaemonConnected 拉取后有效，否则 false）。 */
export function getDaemonConnected(): boolean {
  return daemonConnected;
}

/**
 * 启动拉取 daemon 连接态（真信号）：invoke `is_daemon_connected` 写 store + 广播。
 * 拉失败（命令缺失 / 非 Windows / 降级态）→ false（不抛，不阻塞 GUI）。幂等可重拉。
 */
export async function initDaemonConnected(): Promise<void> {
  try {
    const ok = await invoke<boolean>("is_daemon_connected");
    daemonConnected = ok === true;
  } catch {
    daemonConnected = false;
  }
  notify();
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

/** createSession 入参（全可选；兼容旧 `createSession()` 无参 = 默认 powershell）。 */
export interface CreateSpec {
  /** 启动项名（携带为 launchName；缩点条/Home 显其名）。 */
  name?: string;
  /** 启动程序（无则后端默认 powershell）。 */
  program?: string;
  /** 启动参数（带参 CLI / wsl -d Ubuntu）。 */
  args?: string[];
  /** 工作目录。 */
  cwd?: string;
}

/**
 * 新建会话（「+」/快捷启动）：create_session({program,args,cwd}) → 加入 list + setActive。
 *   - 无参（`createSession()`）= 默认 powershell 会话，name 派生（不破 M④ 默认 "conmux"）。
 *   - 带 spec.name = 快捷启动：entry.launchName=spec.name（缩点条/Home 显其名，D-3）、
 *     launchCommand = 原命令重建（program + args）供 RECENT 重开。
 * 失败抛出（调用方可降级处理，如 toast）；store 不变。
 */
export async function createSession(spec?: CreateSpec): Promise<SessionEntry> {
  const info = await invoke<SessionInfo>("create_session", {
    program: spec?.program ?? null,
    args: spec?.args ?? null,
    cwd: spec?.cwd ?? null,
  });
  const entry = toEntry(info);
  // 携带启动名 / 命令（快捷启动才有；默认会话保持 deriveName）。
  if (spec?.name !== undefined) entry.launchName = spec.name;
  if (spec?.cwd !== undefined) entry.cwd = spec.cwd;
  if (spec?.program !== undefined) {
    entry.launchCommand = rebuildCommand(spec.program, spec.args);
  }
  // 去重插入（后端 paneId 自增不应碰撞，仍防御）。
  if (!sessions.some((s) => s.instanceId === entry.instanceId)) {
    sessions = [...sessions, entry];
  }
  activeId = entry.instanceId;
  notify();
  return entry;
}

/**
 * 由 program + args 重建命令原文（RECENT 重开时再 parse；含空格的词加引号）。
 * 导出供 M⑤h 单测验证 parse↔rebuild 往返（纯函数，无副作用）。
 */
export function rebuildCommand(program: string, args?: string[]): string {
  const quote = (w: string): string => (/\s/.test(w) ? `"${w}"` : w);
  const parts = [program, ...(args ?? [])].map(quote);
  return parts.join(" ");
}

/**
 * 关闭会话（active pill 的 ×）：kill_session(instanceId) → 移除 + active 顺延。
 * 即便后端 kill 报错也清本地（与后端 kill_session 的"失败仍清表"对齐）。
 *
 * M⑤b：若该会话有 launchCommand（快捷启动的会话），push 到 RECENT store（可重开）。
 */
export async function removeSession(instanceId: string): Promise<void> {
  const entry = sessions.find((s) => s.instanceId === instanceId) ?? null;
  try {
    await invoke<void>("kill_session", { instanceId });
  } catch {
    // 后端报错也清本地（避免僵尸缩点项；后端同样已清其表项）。
  }
  const idx = sessions.findIndex((s) => s.instanceId === instanceId);
  if (idx === -1) return;
  // 有 launchCommand（快捷启动的会话）→ 入 RECENT（最近优先、去重、capped）。
  if (entry && entry.launchCommand) {
    pushRecent({
      name: entry.launchName ?? entry.name,
      command: entry.launchCommand,
      ...(entry.cwd ? { cwd: entry.cwd } : {}),
      closedAt: Date.now(),
    });
  }
  const wasActive = activeId === instanceId;
  sessions = sessions.filter((s) => s.instanceId !== instanceId);
  if (wasActive) {
    // active 顺延：优先取被移除位置的邻居（前一个），否则第一个，空则 null。
    const next = sessions[Math.max(0, idx - 1)] ?? sessions[0] ?? null;
    activeId = next ? next.instanceId : null;
  }
  notify();
}

// ===== RECENT store（localStorage，最近关闭可重开）=====

let recent: RecentEntry[] = loadRecent();

function loadRecent(): RecentEntry[] {
  try {
    const raw = localStorage.getItem(RECENT_KEY);
    return parseRecentJson(raw, RECENT_CAP);
  } catch {
    return [];
  }
}

/**
 * RECENT 的纯解析核心（导出供 M⑤h 单测损坏容错验证）：
 * null（无存储）/ 非数组 / 损坏 JSON → []；数组则过滤损坏条目 + capped。
 */
export function parseRecentJson(
  raw: string | null,
  cap: number
): RecentEntry[] {
  if (raw === null) return [];
  try {
    const parsed: unknown = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    return parsed.filter(isRecentEntry).slice(0, cap);
  } catch {
    return [];
  }
}

/** RECENT 条目运行时类型守卫（导出供 M⑤h 单测；纯函数，拒绝损坏条目）。 */
export function isRecentEntry(v: unknown): v is RecentEntry {
  if (typeof v !== "object" || v === null) return false;
  const o = v as Record<string, unknown>;
  return (
    typeof o.name === "string" &&
    typeof o.command === "string" &&
    typeof o.closedAt === "number" &&
    (o.cwd === undefined || typeof o.cwd === "string")
  );
}

/**
 * RECENT push 的纯核心（导出供 M⑤h 单测）：去重（同 command+cwd 取新）、最近优先、capped。
 * 不触模块单例 / localStorage——pushRecent 仅在此之上加持久化 + notify（行为不变）。
 */
export function applyRecentPush(
  list: RecentEntry[],
  entry: RecentEntry,
  cap: number
): RecentEntry[] {
  const sameKey = (e: RecentEntry): boolean =>
    e.command === entry.command && (e.cwd ?? "") === (entry.cwd ?? "");
  return [entry, ...list.filter((e) => !sameKey(e))].slice(0, cap);
}

function persistRecent(): void {
  try {
    localStorage.setItem(RECENT_KEY, JSON.stringify(recent));
  } catch {
    /* 私密模式等 */
  }
}

/** push 到 RECENT（去重：同 command+cwd 取最近一次；最近优先；capped）。 */
function pushRecent(entry: RecentEntry): void {
  recent = applyRecentPush(recent, entry, RECENT_CAP);
  persistRecent();
  notify();
}

/** 当前 RECENT 列表（最近优先）。 */
export function getRecent(): RecentEntry[] {
  return recent;
}

/**
 * 重开一个 RECENT 条目：parse(command) → createSession（携带 name/cwd）。
 * 失败抛出（调用方降级）。成功后该项保留在 RECENT（再次关闭去重刷新时间戳）。
 */
export async function reopenRecent(entry: RecentEntry): Promise<SessionEntry> {
  const { program, args } = parseCommand(entry.command);
  return createSession({
    name: entry.name,
    program,
    args,
    ...(entry.cwd ? { cwd: entry.cwd } : {}),
  });
}
