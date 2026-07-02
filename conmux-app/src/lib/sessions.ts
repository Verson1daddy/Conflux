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
  /**
   * B2（2026-07-02 审计 S1）：裸 claude 快捷启动注入的 `--session-id` UUID。
   * JSONL 观测按它精确锚定 `<id>.jsonl`，消除同 cwd 多活会话按 mtime 串台。
   * 仅注入路径的会话有值；daemon 重连 resync 重建的条目丢失该值（观测降级回
   * mtime 选文件，已知残留，与 launchName/launchCommand 的 resync 丢失同类）。
   */
  claudeSessionId?: string;
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
/** daemon 重连代际（Part 2）：每次自动重连 +1。前端把它编进终端 key 强制重挂载——重连后
 *  pane 是新的（同 id 新流），不重挂载会复用旧死终端的订阅与缓冲。 */
let daemonGeneration = 0;
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

/** daemon 重连代际（Part 2）：终端 key 编入它，每次自动重连 +1 强制终端重挂载。 */
export function getDaemonGeneration(): number {
  return daemonGeneration;
}

/** 单次探活（不写 store）：invoke `is_daemon_connected`（后端真往返 ListThemes 探活）。
 *  拉失败（命令缺失 / 非 Windows / 降级态 / daemon 死亡管道断）→ false（不抛）。 */
async function fetchDaemonConnected(): Promise<boolean> {
  try {
    const ok = await invoke<boolean>("is_daemon_connected");
    return ok === true;
  } catch {
    return false;
  }
}

/**
 * 启动拉取 daemon 连接态（真信号）：invoke `is_daemon_connected` 写 store + 广播。
 * 拉失败（命令缺失 / 非 Windows / 降级态）→ false（不抛，不阻塞 GUI）。幂等可重拉。
 */
export async function initDaemonConnected(): Promise<void> {
  daemonConnected = await fetchDaemonConnected();
  notify();
}

/**
 * daemon 真心跳（M⑤h 真信号 → 心跳升级）：每 `intervalMs` 轮询一次 `is_daemon_connected`
 * （后端真往返 ListThemes 探活），daemon 中途死亡 → 管道断 → 点实时转灰。立即拉一次后起
 * interval。**仅在变化时 notify**（避免每 tick 无谓重渲）。**inflight 守卫**：上一拉未回则
 * 跳过本 tick（防 wedged daemon 下请求堆叠）。返回停止函数（清 interval + 抑制在途回写）。
 */
/** 据后端会话列表重建 store（重连后用）。保留当前 active（若仍在列表），否则取第一个。 */
function resyncSessionsFromList(list: SessionInfo[]): void {
  sessions = list.map(toEntry);
  if (!sessions.some((s) => s.instanceId === activeId)) {
    activeId = sessions.length > 0 ? sessions[0].instanceId : null;
  }
}

/**
 * daemon 自动重连（Part 2）：invoke `reconnect_daemon`（后端重建控制连接 + 据 daemon 真实
 * pane 恢复会话）→ 据返回列表 re-sync store + **bump generation**（前端据此强制终端重挂载，
 * 接新 pane 流）+ daemonConnected=true。失败 → false（不抛，下一 tick 再试）。
 */
export async function tryReconnectDaemon(): Promise<boolean> {
  try {
    const res = await invoke<{ respawned: boolean; sessions: SessionInfo[] }>(
      "reconnect_daemon",
    );
    resyncSessionsFromList(res.sessions);
    // 仅 fresh daemon 真重起新 pane 才 bump generation 强制终端重挂载（接新流）；survivor
    // （daemon 没死、会话仍活）不重挂载——保住 scrollback、不打断终端（红队 SF-2）。
    if (res.respawned) daemonGeneration += 1;
    daemonConnected = true;
    notify();
    return true;
  } catch {
    return false;
  }
}

/**
 * daemon 真心跳（M⑤h → 心跳 → 自愈）：每 `intervalMs` 轮询 `is_daemon_connected`（后端真往返
 * 探活）。**活** → 点亮。**掉线** → 自动 `tryReconnectDaemon`（重建控制 + 恢复会话 + bump
 * generation）；重连失败才置 false。立即拉一次后起 interval；**仅变化时 notify**；**inflight
 * 守卫**（上一拉/重连未回则跳过本 tick）。返回停止函数（清 interval + 抑制在途回写）。
 */
export function startDaemonHeartbeat(intervalMs = 5000): () => void {
  let inflight = false;
  let stopped = false;
  const tick = async (): Promise<void> => {
    if (inflight || stopped) return;
    inflight = true;
    try {
      const alive = await fetchDaemonConnected();
      if (alive) {
        if (!stopped && daemonConnected !== true) {
          daemonConnected = true;
          notify();
        }
        return;
      }
      // 掉线：自动重连。成功 → tryReconnectDaemon 内部已 set true + re-sync + bump gen + notify。
      const reconnected = await tryReconnectDaemon();
      if (!stopped && !reconnected && daemonConnected !== false) {
        daemonConnected = false;
        notify();
      }
    } finally {
      inflight = false;
    }
  };
  void tick(); // 立即拉一次（取代单独 initDaemonConnected 的首拉）
  const id = setInterval(() => void tick(), intervalMs);
  return () => {
    stopped = true;
    clearInterval(id);
  };
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
 * Slice 3：spawn 被信任校验拒绝的结构化错误（后端 SpawnUntrustedError 序列化）。
 *
 * 后端 `spawn_session_into` 捕获 `ConmuxError::UntrustedProgram` 后序列化为 JSON 字符串
 * 经 `Err(String)` 通道返回；前端 `createSession` 解析后抛此 typed error，调用方（App.tsx）
 * 据此弹 pin UI（路径 + 未签名 + 信任并启动 / 取消）。
 *
 * `program` 是真正被拒的目标（shim 或 exe，**非 cmd.exe 包裹层**）——内核 cmd-wrap 加固后
 * 拒绝错误已指向 args 里的 shim 路径，UI 据此 pin 正确目标。
 */
export interface SpawnUntrustedError {
  /** 固定 `"UntrustedProgram"`（type guard）。 */
  kind: "UntrustedProgram";
  /** 被拒的绝对路径（shim 或 exe）。 */
  program: string;
  /** 内核拒绝原因（未签名 / 哈希不匹配等）。 */
  reason: string;
  /** true = 可经 `trust_pin_executable` 自助信任后重试。 */
  pinnable: boolean;
}

/**
 * 判定一个**已解析对象**是否为结构化 UntrustedProgram（typed error，throw/catch 流转 + pin UI 用）。
 * 注意：校验的是对象（非原始字符串）——pinPrompt 存的是对象，渲染读 .program/.reason/.pinnable。
 * 原始 invoke 字符串错误请先经 parseSpawnUntrustedError 解析为对象。
 */
export function isSpawnUntrustedError(e: unknown): e is SpawnUntrustedError {
  if (typeof e !== "object" || e === null) return false;
  const o = e as Record<string, unknown>;
  return (
    o.kind === "UntrustedProgram" &&
    typeof o.program === "string" &&
    typeof o.reason === "string" &&
    typeof o.pinnable === "boolean"
  );
}

/**
 * 把后端 invoke 抛出的原始字符串错误（lib.rs 序列化的 SpawnUntrustedError JSON）解析为
 * 对象；非此类（解析失败 / 形状不符 / 非字符串）返回 null。createSession 用它把 wire 字符串
 * 转成 typed 对象再抛出，使调用方拿到的是对象而非字符串。
 */
export function parseSpawnUntrustedError(e: unknown): SpawnUntrustedError | null {
  if (typeof e !== "string") return null;
  try {
    const obj = JSON.parse(e) as unknown;
    return isSpawnUntrustedError(obj) ? obj : null;
  } catch {
    return null;
  }
}

/**
 * 新建会话（「+」/快捷启动）：create_session({program,args,cwd}) → 加入 list + setActive。
 *   - 无参（`createSession()`）= 默认 powershell 会话，name 派生（不破 M④ 默认 "conmux"）。
 *   - 带 spec.name = 快捷启动：entry.launchName=spec.name（缩点条/Home 显其名，D-3）、
 *     launchCommand = 原命令重建（program + args）供 RECENT 重开。
 *
 * 失败抛出：
 *   - `SpawnUntrustedError`（Slice 3）：信任校验拒绝，调用方弹 pin UI（信任并重试）。
 *   - 其它错误：原字符串抛出（调用方降级处理，如 toast）；store 不变。
 */
export async function createSession(spec?: CreateSpec): Promise<SessionEntry> {
  // B2（2026-07-02 审计 S1）：裸 claude 启动（program=claude、用户零 args）注入
  // `--session-id <uuid>`，JSONL 观测据此精确锚定 `<uuid>.jsonl`（消除同 cwd 多活
  // 会话按 mtime 串台）。用户给了任何显式 args（含自带 --session-id / -c / -p）→
  // 一律不动原命令（veto 纪律）。RECENT 存的 launchCommand 仍按**原始** spec 重建
  // （见下方 rebuildCommand 调用）——重开走本路径重新生成新 id，绝不重放旧 id。
  // 兼容性（红队 NIT 登记）：依赖 claude CLI 支持 --session-id（2026-07 当前版已验
  // 证支持）；老版不识该 flag 会在终端 pane 可见地报 unknown option 并退出（非静默）。
  let invokeArgs = spec?.args ?? null;
  let claudeSessionId: string | undefined;
  if (isBareClaudeLaunch(spec?.program, spec?.args)) {
    claudeSessionId = crypto.randomUUID();
    invokeArgs = ["--session-id", claudeSessionId];
  }
  let info: SessionInfo;
  try {
    info = await invoke<SessionInfo>("create_session", {
      program: spec?.program ?? null,
      args: invokeArgs,
      cwd: spec?.cwd ?? null,
    });
  } catch (e) {
    // Slice 3：后端以 JSON 字符串报信任拒绝 → 解析为 typed 对象再抛（调用方 setPinPrompt 存对象、
    // 渲染读 .program/.reason/.pinnable）。**必须抛对象**：先前 bug = 原样抛字符串致 pin 弹窗
    // 路径/原因空、按钮 disabled（活体 e2e 2026-06-20 抓到）。
    const untrusted = parseSpawnUntrustedError(e);
    if (untrusted) throw untrusted;
    // 其它错误原样抛（字符串形态，调用方降级）。
    throw e;
  }
  const entry = toEntry(info);
  // 携带启动名 / 命令（快捷启动才有；默认会话保持 deriveName）。
  if (spec?.name !== undefined) entry.launchName = spec.name;
  if (spec?.cwd !== undefined) entry.cwd = spec.cwd;
  if (spec?.program !== undefined) {
    entry.launchCommand = rebuildCommand(spec.program, spec.args);
  }
  if (claudeSessionId !== undefined) entry.claudeSessionId = claudeSessionId;
  // 去重插入（后端 paneId 自增不应碰撞，仍防御）。
  if (!sessions.some((s) => s.instanceId === entry.instanceId)) {
    sessions = [...sessions, entry];
  }
  activeId = entry.instanceId;
  notify();
  return entry;
}

/**
 * 裸 claude 启动判定（B2 注入门，纯函数导出供单测）：program basename 为
 * claude / claude.cmd / claude.exe / claude.ps1（大小写无关，容路径与引号），
 * 且用户未给任何 args。任何显式 args → false（不碰用户命令）。
 */
export function isBareClaudeLaunch(program?: string, args?: string[]): boolean {
  if (program === undefined) return false;
  if (args !== undefined && args.length > 0) return false;
  const base = program.trim().replace(/["']/g, "").split(/[\\/]/).pop() ?? "";
  return /^claude(\.(cmd|exe|ps1))?$/i.test(base);
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
 * opts.recordRecent=false 时跳过 RECENT 入库（restartSession 复用：重启≠关闭，不留 RECENT）。
 */
export async function removeSession(
  instanceId: string,
  opts?: { recordRecent?: boolean }
): Promise<void> {
  const recordRecent = opts?.recordRecent ?? true;
  const entry = sessions.find((s) => s.instanceId === instanceId) ?? null;
  try {
    await invoke<void>("kill_session", { instanceId });
  } catch {
    // 后端报错也清本地（避免僵尸缩点项；后端同样已清其表项）。
  }
  const idx = sessions.findIndex((s) => s.instanceId === instanceId);
  if (idx === -1) return;
  // 有 launchCommand（快捷启动的会话）→ 入 RECENT（最近优先、去重、capped）。
  if (recordRecent && entry && entry.launchCommand) {
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

/**
 * 重启会话（退出态右键菜单）：从该会话自身的 launchCommand 复原一个新会话（成为活跃），
 * 再移除旧的退出项。recordRecent:false —— 重启不是关闭，不往 RECENT 留痕。
 *   - 有 launchCommand（快捷启动的会话）→ parse → createSession（携带 name/cwd）。
 *   - 无 launchCommand（默认会话）→ createSession() 默认 powershell。
 * 失败抛出（调用方降级；失败时旧项仍在，不至于丢会话）。
 */
export async function restartSession(instanceId: string): Promise<SessionEntry> {
  const entry = sessions.find((s) => s.instanceId === instanceId) ?? null;
  let spec: CreateSpec | undefined;
  if (entry?.launchCommand) {
    const { program, args } = parseCommand(entry.launchCommand);
    spec = {
      ...(entry.launchName ? { name: entry.launchName } : {}),
      program,
      args,
      ...(entry.cwd ? { cwd: entry.cwd } : {}),
    };
  }
  const created = await createSession(spec);
  // 新会话已 active；移除旧退出项（kill 对已死 pane 无副作用，失败也清表）。
  if (entry) await removeSession(instanceId, { recordRecent: false });
  return created;
}
