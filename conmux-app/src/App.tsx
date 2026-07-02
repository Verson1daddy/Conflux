import {
  useCallback,
  useEffect,
  useReducer,
  useRef,
  useState,
  useSyncExternalStore,
  type MouseEvent as ReactMouseEvent,
} from "react";
import { invoke } from "@tauri-apps/api/core";
import {
  XtermTerminal,
  getRegisteredTerminal,
  initTerminalThemes,
  setTerminalTheme,
  type ProcessExitedPayload,
} from "@conmux/terminal-core";
import { WindowFrame } from "./chrome/WindowFrame";
import { TopBar } from "./chrome/TopBar";
import { StatusBar } from "./chrome/StatusBar";
import { AwareHeader } from "./chrome/AwareHeader";
import { SubagentTree } from "./chrome/SubagentTree";
import { CommandPalette } from "./chrome/CommandPalette";
import { LeaderConfig } from "./chrome/LeaderConfig";
import { Home, type HomeRunningRow } from "./chrome/Home";
import { SessionObserver } from "./observe/session-observer";
import {
  applyChromeVars,
  cycleStyle,
  getCurrentStyle,
  initStyles,
} from "./lib/style";
import { useStyle } from "./lib/useStyle";
import {
  createSession,
  getActiveId,
  getDaemonConnected,
  getDaemonGeneration,
  getSessions,
  startDaemonHeartbeat,
  initSessions,
  removeSession,
  reopenRecent,
  restartSession,
  setActive,
  subscribeSessions,
  isSpawnUntrustedError,
  type CreateSpec,
  type RecentEntry,
  type SessionEntry,
  type SpawnUntrustedError,
} from "./lib/sessions";
import { parseCommand, type LaunchEntry } from "./lib/launch-registry";
import {
  computeDividers,
  computeRects,
  containerAtPath,
  getLayout,
  navigateFocus,
  reconcile,
  resizeFocused,
  resizeSplitByPath,
  splitFocused,
  subscribeLayout,
  toggleZoom,
  type Divider,
} from "./lib/layout";
import { useLeaderKeyboard } from "./lib/leader";
import {
  formatLeaderLabel,
  getLeaderChord,
  subscribeLeaderChord,
} from "./lib/leader-key";
import {
  deriveStatusFromAware,
  type SessionState,
} from "./chrome/session-status";

// M④ 多会话缩点（升级自 M② 单 pane / M③ 壳）：
//   - 后端 per-pane 注册表：N 个真实 daemon pane，命令按 instanceId 路由。
//   - 前端 sessions store：list + activeId（create/switch/remove）。
//   - body mount-all（D-1）：每会话一个 XtermTerminal，CSS 仅显 active——保 live 终端态、
//     切换零重连（N WebGL 上下文，少量会话可接受；多会话优化登记后续）。
//   - 每会话一个 M3-ext SessionObserver（feed 该会话 dot 状态）；aware-header 显 active 会话态。
//   - 换肤（M③）：换一组 chrome CSS 变量 + setTerminalTheme(配对预置)，chrome 与终端协调跟随。
const ADAPTER_ID = "pwsh";

export default function App() {
  // 当前风格（订阅 store；驱动 chrome 重渲染）。
  const style = useStyle();

  // ===== 命令面板（M⑤a，Ctrl+K 开关）=====
  // 唯一全局键 Ctrl+K（spec §1.1 / D-1）：拦截 toggle；面板关时键照常透传终端（不加别的全局拦截）。
  const [paletteOpen, setPaletteOpen] = useState(false);

  // ===== leader 待命态（M⑤c §3）：armed 时 StatusBar 显 ⌨ LEADER 徽章 =====
  const [leaderArmed, setLeaderArmed] = useState(false);

  // ===== 可用 skills 计数（M⑥ §5/D-5，会话无关，App 级一次性拉取）=====
  // null = 未拉到（拉取中 / 失败）→ AwareHeader 不渲染计数（诚实降级）。
  // 文案标"已安装"非"已加载"（磁盘枚举 = 机器上安装的 skills）。
  const [skillCount, setSkillCount] = useState<number | null>(null);

  // ===== Home overlay（M⑤d §2）：leader+h 在「有会话」时把 Home 作为叠层开在活跃会话之上 =====
  // 有自己的键盘（↑↓⏎esc），开时经 isBlocked 抑制 leader 待命（不增拦截面，veto 安全只增不减）。
  const [homeOverlayOpen, setHomeOverlayOpen] = useState(false);
  // ref 镜像：leader 机 isBlocked 回调读最新态（listener 一次装配，闭包不刷新）。
  const homeOverlayOpenRef = useRef(homeOverlayOpen);
  homeOverlayOpenRef.current = homeOverlayOpen;

  // ===== leader 前缀配置 modal（可配置化 2026-06-19）：命令面板「设置 leader 前缀」打开 =====
  // 开时经 isBlocked 抑制 leader 待命（modal 自己 capture 抓新组合键，leader 机不该 arm）。
  const [leaderConfigOpen, setLeaderConfigOpen] = useState(false);
  const leaderConfigOpenRef = useRef(leaderConfigOpen);
  leaderConfigOpenRef.current = leaderConfigOpen;

  // ===== Slice 3 pin UI（最小功能化）：spawn 被信任校验拒绝时弹此提示 =====
  // 显示被拒程序路径 + "未签名"，用户点"信任并启动" → trust_pin_executable → 重试 createSession；
  // 可取消。pendingSpec 缓存被拒的启动参数（重试时复用，不丢用户输入的 args/cwd）。
  // pinning=true 时禁用按钮（防双击）；pinError 显 pin 失败原因（如文件不存在）。
  const [pinPrompt, setPinPrompt] = useState<SpawnUntrustedError | null>(null);
  const [pinPendingSpec, setPinPendingSpec] = useState<CreateSpec | undefined>(undefined);
  const [pinning, setPinning] = useState(false);
  const [pinError, setPinError] = useState<string | null>(null);
  // 当前 leader 前缀（响应式订阅；StatusBar 徽章 + 配置回显用）。
  const leaderChord = useSyncExternalStore(subscribeLeaderChord, getLeaderChord);
  const leaderLabel = formatLeaderLabel(leaderChord);

  // ===== 会话 store 订阅 =====
  const sessions = useSyncExternalStore(subscribeSessions, getSessions);
  const activeId = useSyncExternalStore(subscribeSessions, getActiveId);
  // daemon 连接真信号（M⑤h）：启动 invoke is_daemon_connected 拉一次写 store；
  // 同一 notify 广播驱动重渲染（拉失败 / 非 Windows → false 降级）。
  const daemonConnected = useSyncExternalStore(
    subscribeSessions,
    getDaemonConnected
  );
  // daemon 重连代际（Part 2）：每次自动重连 +1，编进终端 key 强制重挂载（接新 pane 流）。
  const daemonGen = useSyncExternalStore(subscribeSessions, getDaemonGeneration);

  // ===== 分屏布局（同屏 pane）：订阅 layout store（tree + 焦点 + 缩放）。 =====
  const layout = useSyncExternalStore(subscribeLayout, getLayout);
  // 分屏 in-flight 守卫（红队 #2）：splitPane 的 createSession 是 async，两次快速 leader+\ 会
  // 都读到同一个 prev active → 第二次在已被 reconcile 换出的旧叶上再分裂 → 重复叶 + 丢 pane。
  // 一次只允许一个分屏 spawn 在途，期间忽略二次触发（用户可在落定后再分）。ref 跨重渲稳定。
  const splittingRef = useRef(false);
  // 拖分隔线调 pane 大小：body 容器 ref（取像素 bounds 换算 ratio）+ resizing 态（拖动时把
  // pane 层 pointerEvents 关掉，免 xterm 抢鼠标/误选文本）。
  const bodyRef = useRef<HTMLDivElement>(null);
  const [resizing, setResizing] = useState(false);

  // ===== per-session 观测者（M3-ext，feed dot 状态 + aware-header）=====
  // ref Map：instanceId → SessionObserver。随 sessions list 增删同步 start/stop。
  const observersRef = useRef<Map<string, SessionObserver>>(new Map());
  // dot 状态强制重渲染：任一 observer 状态变化 → bump（驱动缩点条 dot 颜色翻转）。
  const [, bumpDots] = useReducer((n: number) => n + 1, 0);
  // per-session 退出信息（退出态条展示用；onPtyExit 写）。
  const [exitInfo, setExitInfo] = useState<Map<string, ProcessExitedPayload>>(
    new Map()
  );
  // ref 镜像：XtermTerminal 轮询闭包读最新退出态（避免 stale 闭包）。
  const exitedRef = useRef<Set<string>>(new Set());

  // 重连提示条（SF-3）：daemon 真死亡 → 自动重起新会话是静默的（dot 恒绿），给个短暂提示
  // 让用户知道旧会话已没、已起新默认会话。gen 仅真重起（fresh daemon）时 +1，故它是诚实触发。
  const [reconnectNotice, setReconnectNotice] = useState(false);

  // 重连代际变化（Part 2）：re-synced 会话是全新 pane → 清旧退出态（exit bar）+ 重启 observer
  // （旧 observer 持陈旧 exited/elapsed，否则 aware-header 会在一个活终端上显"已退出"）。下方
  // observer 同步 effect（deps sessions，重连时 sessions 也变）随即把它们重建为新观测者。
  // 首挂载 gen=0：退出态/observer 本就空，全为 no-op；仅重连（gen 变）真正清 + 提示（SF-3）。
  useEffect(() => {
    exitedRef.current.clear();
    setExitInfo(new Map());
    for (const [, obs] of observersRef.current) obs.stop();
    observersRef.current.clear();
    if (daemonGen === 0) return; // 首挂载不提示
    setReconnectNotice(true);
    const t = setTimeout(() => setReconnectNotice(false), 4500);
    return () => clearTimeout(t);
  }, [daemonGen]);

  // 同步 observers 与 sessions list：新会话起观测者 + 订阅 bump；移除的停掉。
  useEffect(() => {
    const map = observersRef.current;
    const live = new Set(sessions.map((s) => s.instanceId));

    // 移除已不在 list 的观测者（会话被关闭）。
    for (const [id, obs] of map) {
      if (!live.has(id)) {
        obs.stop();
        map.delete(id);
      }
    }
    // 为新会话建观测者并启动 + 订阅（dot 状态变化触发 bump）。
    // M⑥：传 launchCwd（SessionEntry.cwd，启动 cwd）作 JSONL 源 cwd（OSC7 未捕获时）；
    // launchIsClaude（launchCommand 含 claude）= 启动意图，绕开脆弱 PTY sniff 直接启 JSONL 源（D-10）。
    const unsubs: Array<() => void> = [];
    for (const s of sessions) {
      if (!map.has(s.instanceId)) {
        const launchIsClaude = /\bclaude\b/i.test(s.launchCommand ?? "");
        // B2：注入启动的 claude 会话携带 session-id → JSONL 观测精确锚定（防串台）。
        const obs = new SessionObserver(
          s.instanceId,
          s.cwd,
          launchIsClaude,
          s.claudeSessionId,
        );
        map.set(s.instanceId, obs);
        obs.start();
      }
      const obs = map.get(s.instanceId)!;
      unsubs.push(obs.subscribe(() => bumpDots()));
    }
    return () => {
      for (const u of unsubs) u();
    };
  }, [sessions]);

  // 卸载时停掉所有观测者（StrictMode dev 二次挂载下 observer.start 幂等 + stop 清理）。
  useEffect(() => {
    const map = observersRef.current;
    return () => {
      for (const [, obs] of map) obs.stop();
      map.clear();
    };
  }, []);

  // ===== 启动：拉会话 + 终端预置 + 风格 =====
  useEffect(() => {
    let cancelled = false;
    void (async () => {
      // 顺序：先 themes（setTerminalTheme 校验 id 必须在已加载列表里），后 styles。
      await initTerminalThemes();
      await initStyles();
      await initSessions(); // list_sessions → 构建缩点条 + active = 第一个
      if (cancelled) return;
      const current = getCurrentStyle();
      setTerminalTheme(current.terminal_theme_id);
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  // ===== daemon 真心跳：周期轮询 is_daemon_connected（后端真往返探活），daemon
  // 中途死亡 → 点实时转灰。首拉即时，挂载起停 interval（取代旧 initDaemonConnected 单拉）。
  useEffect(() => startDaemonHeartbeat(5000), []);

  // ===== 分屏布局对账（单一收敛点）：会话/activeId 变 → reconcile 维护"active 永远显示在
  // 焦点 pane"（剪死会话 + 树空起单叶 + active 未显示则 swap 进焦点叶）。单 pane 切 tab 零回归。
  useEffect(() => {
    reconcile(
      sessions.map((s) => s.instanceId),
      activeId
    );
  }, [sessions, activeId]);

  // 风格变化（含初次）→ 写 chrome CSS 变量 + 取配对 TerminalTheme 喂 xterm。
  useEffect(() => {
    applyChromeVars(style);
    setTerminalTheme(style.terminal_theme_id);
  }, [style]);

  // ===== 启动：一次性拉可用 skills（M⑥ §5/D-5，会话无关）=====
  // 后端 list_available_skills 返 [{name,description}] JSON 串；只用计数。失败 → 保 null
  // （AwareHeader 不渲染计数，诚实降级，不崩）。
  useEffect(() => {
    let cancelled = false;
    void (async () => {
      try {
        const raw = await invoke<string>("list_available_skills");
        const parsed: unknown = JSON.parse(raw);
        if (!cancelled && Array.isArray(parsed)) setSkillCount(parsed.length);
      } catch {
        // 命令缺失 / 非 Windows / 目录不存在 → 保 null（不显计数）。
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  // ===== 全局 Ctrl+K → toggle 命令面板（M⑤a，spec §1.1 唯一默认全局键 / D-1）=====
  // 承认 tradeoff：全局拦截 Ctrl+K 会盖掉终端 readline kill-line（无冲突替代 leader+: 留 M⑤c）。
  // 仅此一个全局拦截；面板关时其余键照常透传终端。
  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.ctrlKey && (e.key === "k" || e.key === "K")) {
        e.preventDefault();
        setPaletteOpen((v) => !v);
      }
    };
    document.addEventListener("keydown", onKeyDown);
    return () => document.removeEventListener("keydown", onKeyDown);
  }, []);

  // ===== leader 键盘仲裁（M⑤c §1）：capture 阶段 document keydown，tmux 式前缀（默认 Ctrl+B）=====
  // 默认全透传（veto 级：仅前缀键被 conmux 取走）；armed 时下一个键解释为命令（切会话 /
  // 开面板 / leader-leader 送前缀字面）后退待命。读 lib/sessions live 态，setPaletteOpen / armed
  // 徽章经 App state（hook 内部 ref 镜像最新回调，listener 一次装配无 stale）。
  // M⑤d 增量：leader+h→toggle Home overlay · leader+s→cycleStyle · isBlocked→overlay 开时抑制待命。
  //
  // leader+h → toggle Home overlay（M⑤d §1/§2，仅「有会话」时开；0 会话 landing 已在）。
  // 读 sessions live 态（getSessions，避免 stale）：开态总可关；关态仅 sessions>0 才开（D-1 互斥）。
  const toggleHomeOverlay = useCallback(() => {
    setHomeOverlayOpen((open) => {
      if (open) return false; // 已开 → 关。
      return getSessions().length > 0; // 关 → 仅有会话才开（0 会话 landing 已在）。
    });
  }, []);

  useLeaderKeyboard({
    setPaletteOpen: (open) => setPaletteOpen(open),
    onArmedChange: setLeaderArmed,
    // leader+h → 开/关 Home overlay（M⑤d §1）。
    openHomeOverlay: toggleHomeOverlay,
    // leader+s → 切风格（M⑤d §1/D-4），复用缩点条换肤钮同款 cycleStyle。
    cycleStyle,
    // leader+\/-：分屏焦点 pane（唯一加 pane 路径）——spawn 新默认会话占新叶，焦点移过去。
    // prev=split 前 active（split 目标叶）；新会话恒默认 powershell（受信），故无需 pin UI。
    splitPane: (dir) => {
      // in-flight 守卫（红队 #2）：上一个分屏 spawn 未落定前忽略二次触发，杜绝重复叶竞态。
      if (splittingRef.current) return;
      splittingRef.current = true;
      const prev = getActiveId();
      void createSession()
        .then((e) => {
          if (prev !== null) splitFocused(prev, dir, e.instanceId);
          getRegisteredTerminal(e.instanceId)?.focus();
        })
        .catch((err) => console.error("[conmux] 分屏失败:", err))
        .finally(() => {
          splittingRef.current = false;
        });
    },
    // leader+方向：几何导航 pane 焦点 → setActive + 聚焦其终端（reconcile 不 swap，已在树中）。
    navigatePane: (dir) => {
      const target = navigateFocus(dir);
      if (target) {
        setActive(target);
        getRegisteredTerminal(target)?.focus();
      }
    },
    // leader+z：当前焦点 pane 全屏⇄还原。
    toggleZoomPane: () => toggleZoom(),
    // leader+Shift+方向：调焦点 pane 大小（v 轴宽 / h 轴高，grow=变大）。reconcile 不动（仅改 ratio）。
    resizePane: (axis, grow) => resizeFocused(axis, grow),
    // Home overlay / leader 配置 modal 开时抑制 leader 待命：它们自有键盘，前缀键放行不 arm。
    isBlocked: () => homeOverlayOpenRef.current || leaderConfigOpenRef.current,
  });

  // ===== Home `n` 键 → 新建默认会话（M⑤b §4，仅 0 会话 Home 时；v1 先鼠标点 + n/Ctrl+K）=====
  // 仅当 0 会话（Home 在屏）且焦点不在输入框（加项表单输入 'n' 应正常打字）时拦截。
  useEffect(() => {
    if (sessions.length !== 0) return; // 有会话时不拦 n（透传终端）。
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.ctrlKey || e.metaKey || e.altKey) return;
      const t = e.target as HTMLElement | null;
      const tag = t?.tagName;
      if (tag === "INPUT" || tag === "TEXTAREA" || t?.isContentEditable) return;
      if (e.key === "n" || e.key === "N") {
        e.preventDefault();
        void createSession().catch((err) => {
          console.error("[conmux] 新建会话失败:", err);
        });
      }
    };
    document.addEventListener("keydown", onKeyDown);
    return () => document.removeEventListener("keydown", onKeyDown);
  }, [sessions.length]);

  // overlay 防卡（M⑤d §2/§4）：sessions 降到 0 时自动关 Home overlay——
  // 否则 overlay 渲染条件（sessions>0）不满足致内容消失但 state 仍 true（isBlocked 仍抑制 leader、
  // 与 landing 键盘并存），关掉回到 landing Home 干净态。
  useEffect(() => {
    if (sessions.length === 0 && homeOverlayOpen) setHomeOverlayOpen(false);
  }, [sessions.length, homeOverlayOpen]);

  // ===== 退出态（per-session）=====
  const handlePtyExit = useCallback(
    (instanceId: string, payload: ProcessExitedPayload) => {
      exitedRef.current.add(instanceId);
      setExitInfo((prev) => {
        const next = new Map(prev);
        next.set(instanceId, payload);
        return next;
      });
    },
    []
  );

  const isExitDetected = useCallback(
    (instanceId: string) => exitedRef.current.has(instanceId),
    []
  );

  // ===== 缩点条会话项（status 由各会话观测者 AwareState 派生）=====
  // M⑤b：显示名优先 launchName（快捷启动的会话显其名，如 "WSL"/"claude"）；
  // 默认会话无 launchName → 回退 deriveName（仍 "conmux"，不破 M④）。
  const sessionStates: SessionState[] = sessions.map((s: SessionEntry) => {
    const obs = observersRef.current.get(s.instanceId);
    const aware = obs?.getSnapshot();
    const isActive = s.instanceId === activeId;
    const baseStatus = aware ? deriveStatusFromAware(aware) : "running";
    // attention 真路由（MF-3）：非活跃会话被真信号（BEL/退出）标 attention → 缩点脉冲。
    // 活跃会话不显（你正看着；由下方 effect 即时 ack 清除）。
    const status =
      aware?.attention && !isActive ? "attention" : baseStatus;
    return {
      instanceId: s.instanceId,
      name: s.launchName ?? s.name,
      status,
      active: isActive,
      // 退出态（aware.status==="exited"）→ 右键菜单据此提供「重启」。
      exited: aware?.status === "exited",
    };
  });

  // ===== Home RUNNING 行（仅 0 会话时 Home 隐 RUNNING；此处恒构建供 M⑤c 复用）=====
  const homeRunning: HomeRunningRow[] = sessions.map((s: SessionEntry) => {
    const obs = observersRef.current.get(s.instanceId);
    const aware = obs?.getSnapshot();
    return {
      instanceId: s.instanceId,
      name: s.launchName ?? s.name,
      status: aware ? deriveStatusFromAware(aware) : "running",
      activity: aware?.activity ?? null,
    };
  });

  // ===== 交互回调 =====
  // 程序化聚焦目标 pane 的终端（切会话/leader 导航后，键盘进对的 pane）。已挂载才有效。
  const focusTerminal = useCallback((instanceId: string) => {
    getRegisteredTerminal(instanceId)?.focus();
  }, []);

  const handleSelect = useCallback(
    (instanceId: string) => {
      setActive(instanceId); // reconcile effect 处理布局（已显示=移焦点，未显示=swap 进焦点 pane）
      focusTerminal(instanceId);
    },
    [focusTerminal]
  );

  // 拖分隔线调 pane 大小（鼠标）：down 时取 body 像素 bounds + 该 split 外层容器（拖动中不变），
  // move 时把鼠标位置换算成该 split 的 ratio 实时写回；拖动期间关 pane 层 pointerEvents 防 xterm
  // 抢鼠标。window 级 listener 保证拖出热区也跟手。
  const startDividerDrag = useCallback((e: ReactMouseEvent, divider: Divider) => {
    e.preventDefault();
    const bodyEl = bodyRef.current;
    if (!bodyEl) return;
    const box = bodyEl.getBoundingClientRect();
    if (box.width === 0 || box.height === 0) return;
    const cont = containerAtPath(getLayout().tree, divider.path);
    setResizing(true);
    const move = (ev: MouseEvent): void => {
      const ratio =
        divider.dir === "v"
          ? ((ev.clientX - box.left) / box.width - cont.x) / cont.w
          : ((ev.clientY - box.top) / box.height - cont.y) / cont.h;
      resizeSplitByPath(divider.path, ratio); // clamp 在 setRatioAtPath 内
    };
    const up = (): void => {
      setResizing(false); // 红队 L-1：blur/pointercancel 也复位，防丢 mouseup 卡死 pane 指针事件
      window.removeEventListener("mousemove", move);
      window.removeEventListener("mouseup", up);
      window.removeEventListener("pointercancel", up);
      window.removeEventListener("blur", up);
    };
    window.addEventListener("mousemove", move);
    window.addEventListener("mouseup", up);
    window.addEventListener("pointercancel", up);
    window.addEventListener("blur", up);
  }, []);

  // Home overlay 点 RUNNING 行（M⑤d §2）：切到该会话 + 关叠层（焦点回终端）。
  const handleSelectRunning = useCallback((instanceId: string) => {
    setActive(instanceId);
    setHomeOverlayOpen(false);
  }, []);

  // ===== Slice 3 pin UI 回调（定义在 handleCreate 之前，供其依赖）=====
  // handleCreateError：createSession 失败统一处理——UntrustedProgram 弹 pin UI（缓存 spec
  // 供重试），其它错误记 console。restartSession 失败时 spec 无法精确复原（其内部已 parse），
  // pin 后重试只能用 undefined spec（默认 powershell）——可接受（重启场景罕见命中信任拒绝）。
  const handleCreateError = useCallback((e: unknown, spec?: CreateSpec) => {
    if (isSpawnUntrustedError(e)) {
      setPinPendingSpec(spec);
      setPinError(null);
      setPinPrompt(e);
      return;
    }
    console.error("[conmux] 新建会话失败:", e);
  }, []);

  // handlePinAndRetry：用户点"信任并启动" → trust_pin_executable(program) → 重试 createSession。
  // pin 成功后 daemon 内存态即时生效（IPC），重试 spawn 应过；仍失败则更新 pinError（如哈希变）。
  // pin 失败（文件不存在 / IO 错）→ pinError 显原因，弹窗不关（用户可取消或修正后重试）。
  const handlePinAndRetry = useCallback(async () => {
    const err = pinPrompt;
    if (!err || !err.pinnable) return;
    setPinning(true);
    setPinError(null);
    try {
      await invoke<void>("trust_pin_executable", { path: err.program });
    } catch (pinErr) {
      setPinning(false);
      setPinError(typeof pinErr === "string" ? pinErr : String(pinErr));
      return;
    }
    // pin 成功 → 重试原 spec。成功则关弹窗；失败则按新错误分流（可能仍是 UntrustedProgram，
    // 如 daemon 旧版无 IPC、回退直写文件但 daemon 未重启 → 仍拒 → 更新 pinPrompt 留弹窗）。
    try {
      await createSession(pinPendingSpec);
      setPinPrompt(null);
      setPinPendingSpec(undefined);
    } catch (retryErr) {
      if (isSpawnUntrustedError(retryErr)) {
        setPinPrompt(retryErr);
      } else {
        setPinError(typeof retryErr === "string" ? retryErr : String(retryErr));
      }
    } finally {
      setPinning(false);
    }
  }, [pinPrompt, pinPendingSpec]);

  const handlePinCancel = useCallback(() => {
    setPinPrompt(null);
    setPinPendingSpec(undefined);
    setPinError(null);
    setPinning(false);
  }, []);

  const handleCreate = useCallback(() => {
    void createSession().catch(handleCreateError);
  }, [handleCreateError]);

  // Home QUICK LAUNCH chip → parse 命令 → 起为新会话（D-1，携带 launchName）。
  const handleLaunch = useCallback((entry: LaunchEntry) => {
    const { program, args } = parseCommand(entry.command);
    void createSession({
      name: entry.name,
      program,
      args,
      ...(entry.cwd ? { cwd: entry.cwd } : {}),
    }).catch(handleCreateError);
  }, [handleCreateError]);

  // Home RECENT → 重开（parse 原命令 → 起为新会话，携带 launchName/cwd）。
  const handleReopenRecent = useCallback((entry: RecentEntry) => {
    void reopenRecent(entry).catch(handleCreateError);
  }, [handleCreateError]);

  const clearExitMirror = useCallback((instanceId: string) => {
    // 清退出态镜像（避免移除/重启后残留陈旧退出信息）。
    exitedRef.current.delete(instanceId);
    setExitInfo((prev) => {
      if (!prev.has(instanceId)) return prev;
      const next = new Map(prev);
      next.delete(instanceId);
      return next;
    });
  }, []);

  const handleClose = useCallback(
    (instanceId: string) => {
      clearExitMirror(instanceId);
      void removeSession(instanceId);
    },
    [clearExitMirror]
  );

  // 退出态右键菜单「重启」：从该会话 launchCommand 复原新会话 + 移除旧退出项。
  const handleRestart = useCallback(
    (instanceId: string) => {
      clearExitMirror(instanceId);
      void restartSession(instanceId).catch(handleCreateError);
    },
    [clearExitMirror, handleCreateError]
  );

  // active 会话的观测者（驱动 aware-header）。无会话时为 null。
  const activeObserver =
    activeId !== null ? observersRef.current.get(activeId) ?? null : null;

  // attention 真路由清除（MF-3）：活跃会话被标 attention（你正看着时它响铃/退出）→ 即时 ack。
  // 切到带 attention 的会话即清（activeId 变 → effect 跑 → ack）。
  const activeAttention = activeObserver?.getSnapshot().attention ?? false;
  useEffect(() => {
    if (activeAttention) activeObserver?.acknowledgeAttention();
  }, [activeId, activeAttention, activeObserver]);

  // ===== 分屏渲染派生：各显示中会话的矩形（分数）+ 缩放目标 + pane 数 =====
  // 单 pane（单叶）= 全屏 = 与分屏前像素一致（零回归）；多 pane 按 rect 定位、焦点 pane 加描边。
  const paneRects = computeRects(layout.tree);
  const zoomedId = layout.zoomedSessionId;
  const paneCount = zoomedId !== null ? 1 : paneRects.size;
  const multiPane = paneCount > 1;

  return (
    <WindowFrame>
      <TopBar
        sessions={sessionStates}
        onSelect={handleSelect}
        onCreate={handleCreate}
        onClose={handleClose}
        onRestart={handleRestart}
        styleName={style.name}
        onCycleStyle={cycleStyle}
      />

      {/* aware-header（M3-ext / M⑥）：显当前 active 会话的诚实观测态 + skills 计数。
          无会话时不渲染。skillCount = App 级一次性拉取（会话无关）。 */}
      {activeObserver && (
        <AwareHeader observer={activeObserver} skillCount={skillCount} />
      )}

      {/* subagent 树（M3-ext-2）：当前 active 会话真实观测到的子 agent 派发树。
          subagents=[] 时组件自渲 null（诚实空，不占位）；仅 active 会话。 */}
      {activeObserver && <SubagentTree observer={activeObserver} />}

      {/* pane（body）：fill surface.base、flex 占满。padding [14,16] 落在每个 pane 层
          （mount-all 各 pane 绝对定位叠放，padding 在 pane 内以免与 body 重复）。
          mount-all（D-1）：每会话一个 XtermTerminal，CSS 仅显 active（保 live 态、切换零重连）。 */}
      <div
        ref={bodyRef}
        data-testid="conmux-body"
        style={{
          flex: 1,
          minHeight: 0,
          position: "relative",
          background: "var(--cx-surface-base)",
          boxSizing: "border-box",
        }}
      >
        {/* 重连提示条（SF-3）：daemon 真死亡自愈后短暂提示（4.5s 自消），走 chrome 变量随风格。 */}
        {reconnectNotice && (
          <div
            data-testid="conmux-reconnect-notice"
            role="status"
            style={{
              position: "absolute",
              top: 12,
              left: "50%",
              transform: "translateX(-50%)",
              zIndex: 20,
              display: "flex",
              alignItems: "center",
              gap: 8,
              padding: "6px 14px",
              background: "var(--cx-surface-raised)",
              border: "1px solid var(--cx-line-hairline)",
              borderRadius: 6,
              fontFamily: "'JetBrains Mono', 'JetBrains Mono Variable', monospace",
              fontSize: 11,
              letterSpacing: 0.5,
              color: "var(--cx-text-primary)",
              boxShadow: "0 2px 10px rgba(0,0,0,0.14)",
            }}
          >
            <span
              aria-hidden="true"
              style={{
                width: 7,
                height: 7,
                borderRadius: "50%",
                background: "var(--cx-accent-signal)",
                flex: "0 0 auto",
              }}
            />
            daemon 已重连 · 新建默认会话
          </div>
        )}
        {sessions.map((s) => {
          const isActive = s.instanceId === activeId;
          const sExit = exitInfo.get(s.instanceId) ?? null;
          // 缩放：只显缩放会话全屏；否则按布局矩形定位；不在布局 → 隐藏（仍挂载）。
          const rect = paneRects.get(s.instanceId) ?? null;
          const shown =
            zoomedId !== null ? s.instanceId === zoomedId : rect !== null;
          const r =
            zoomedId !== null
              ? s.instanceId === zoomedId
                ? { x: 0, y: 0, w: 1, h: 1 }
                : null
              : rect;
          return (
            <div
              key={`${s.instanceId}:${daemonGen}`}
              data-testid={`conmux-pane-${s.instanceId}`}
              data-active={isActive ? "true" : "false"}
              // 点击 pane 即聚焦它（鼠标交互 #1）：capture 阶段 setActive，不 preventDefault →
              // xterm 仍正常收 mousedown（光标/选区）。多 pane 时换焦点 pane，单 pane 无副作用。
              onMouseDownCapture={() => {
                if (s.instanceId !== activeId) setActive(s.instanceId);
              }}
              style={{
                position: "absolute",
                left: r ? `${r.x * 100}%` : 0,
                top: r ? `${r.y * 100}%` : 0,
                width: r ? `${r.w * 100}%` : "100%",
                height: r ? `${r.h * 100}%` : "100%",
                // 单 pane 保留原 14/16 舒适内边距（零回归）；多 pane 收紧成 8px 间隔。
                padding: multiPane ? 8 : "14px 16px",
                // 显示中 pane 显（保持挂载 = live 终端态不丢、切换零重连）；其余隐藏。
                display: shown ? "block" : "none",
                boxSizing: "border-box",
                // 拖分隔线期间关 pane 指针事件 → 鼠标移过别的 pane 不被 xterm 抢（光标/选区）。
                pointerEvents: resizing ? "none" : undefined,
                // 多 pane 时焦点 pane 加 accent 内描边（单 pane 无需）。
                boxShadow:
                  multiPane && isActive
                    ? "inset 0 0 0 1.5px var(--cx-accent-signal)"
                    : undefined,
              }}
            >
              <XtermTerminal
                instanceId={s.instanceId}
                adapterId={ADAPTER_ID}
                interactive
                subscribeToPty
                onPtyExit={(payload) => handlePtyExit(s.instanceId, payload)}
                isExitDetected={() => isExitDetected(s.instanceId)}
              />
              {sExit && (
                <div
                  data-testid={`conmux-exit-bar-${s.instanceId}`}
                  style={{
                    position: "absolute",
                    left: 16,
                    right: 16,
                    bottom: 14,
                    padding: "6px 14px",
                    fontFamily: "'JetBrains Mono', monospace",
                    fontSize: 12,
                    color: "var(--cx-text-primary)",
                    background: "var(--cx-surface-raised)",
                    border: "1px solid var(--cx-accent-signal)",
                    borderRadius: 6,
                    boxSizing: "border-box",
                  }}
                >
                  进程已退出
                  {sExit.exit_code !== null
                    ? `（exit code ${sExit.exit_code}）`
                    : ""}
                </div>
              )}
            </div>
          );
        })}
        {/* 分隔线（鼠标拖调 pane 大小 #1+#2）：多 pane 且非缩放时，每个 split 一条可拖热区。
            热区透明、中心一条 hairline，hover/拖动时显 accent；cursor 随方向。zIndex 高于 pane。 */}
        {multiPane &&
          zoomedId === null &&
          computeDividers(layout.tree).map((d, i) => (
            <div
              key={`divider-${d.path.join("") || "root"}-${i}`}
              data-testid={`conmux-divider-${d.dir}`}
              onMouseDown={(e) => startDividerDrag(e, d)}
              style={{
                position: "absolute",
                left: `${d.rect.x * 100}%`,
                top: `${d.rect.y * 100}%`,
                width: `${d.rect.w * 100}%`,
                height: `${d.rect.h * 100}%`,
                cursor: d.dir === "v" ? "col-resize" : "row-resize",
                zIndex: 10,
                display: "flex",
                alignItems: "center",
                justifyContent: "center",
                background: "transparent",
              }}
            >
              {/* 中心 hairline：竖线/横线，随风格 accent，半透常态、拖动态由父 cursor 提示。 */}
              <div
                style={{
                  background: "var(--cx-line-hairline)",
                  width: d.dir === "v" ? 1 : "100%",
                  height: d.dir === "v" ? "100%" : 1,
                }}
              />
            </div>
          ))}
        {/* 0 会话（降级态 / 全部关闭）→ Home 仪表盘（M⑤b D-2，替换 M④「无会话」兜底）：
            RECENT 重开 + QUICK LAUNCH 快捷启动 + 加项；不留空白、可一键起会话。 */}
        {sessions.length === 0 && (
          <Home
            sessionCount={sessions.length}
            daemonConnected={daemonConnected}
            running={homeRunning}
            onNewDefault={handleCreate}
            onLaunch={handleLaunch}
            onReopenRecent={handleReopenRecent}
          />
        )}
      </div>

      <StatusBar
        paneCount={paneCount}
        sessionCount={sessions.length}
        daemonConnected={daemonConnected}
        leaderArmed={leaderArmed}
        leaderLabel={leaderLabel}
      />

      {/* 命令面板（M⑤a）：Ctrl+K 开（fixed scrim 覆盖全窗，DOM 末位不影响壳布局）。
          关时不挂载（条件渲染——卸载触发预览还原闭环兜底）。 */}
      {paletteOpen && (
        <CommandPalette
          open
          onClose={() => setPaletteOpen(false)}
          onConfigureLeader={() => {
            setPaletteOpen(false);
            setLeaderConfigOpen(true);
          }}
        />
      )}

      {/* leader 前缀配置 modal（可配置化）：命令面板「设置 leader 前缀」打开；
          捕获新组合键 → 校验（须带 Ctrl/Alt）→ 持久。开时 isBlocked 抑制 leader 待命。 */}
      {leaderConfigOpen && (
        <LeaderConfig onClose={() => setLeaderConfigOpen(false)} />
      )}

      {/* Home overlay（M⑤d §2）：leader+h 在「有会话」时把 Home 作为叠层开在活跃会话之上
          （fixed scrim + 居中 card，DOM 末位覆盖全窗，zIndex 1000）。与 landing（0 会话）互斥：
          仅 sessions.length>0 才渲（0 会话时 landing Home 已在 body）。RUNNING 段恒渲且每行可点 →
          切会话 + 关叠层。esc / 点 scrim / leader+h 再按 关闭。 */}
      {homeOverlayOpen && sessions.length > 0 && (
        <Home
          overlay
          sessionCount={sessions.length}
          daemonConnected={daemonConnected}
          running={homeRunning}
          onNewDefault={handleCreate}
          onLaunch={handleLaunch}
          onReopenRecent={handleReopenRecent}
          onClose={() => setHomeOverlayOpen(false)}
          onSelectRunning={handleSelectRunning}
        />
      )}

      {/* Slice 3 pin UI（最小功能化）：spawn 被信任校验拒绝时弹此提示。
          走 --cx-* 变量随风格；不追求终版视觉（终版另走 Pencil）。
          显示被拒程序路径 + "未签名" + 原因；"信任并启动" → trust_pin_executable → 重试；
          "取消" 关弹窗。pinning 时禁用按钮防双击；pinError 显 pin 失败原因。 */}
      {pinPrompt && (
        <div
          style={{
            position: "fixed",
            inset: 0,
            zIndex: 1100,
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            background: "rgba(0,0,0,0.4)",
          }}
        >
          <div
            style={{
              background: "var(--cx-surface-raised)",
              border: "1px solid var(--cx-line-hairline)",
              borderRadius: 8,
              padding: 24,
              maxWidth: 480,
              width: "90%",
              color: "var(--cx-text-primary)",
              fontFamily: "var(--cx-font-sans, system-ui, sans-serif)",
            }}
          >
            <div style={{ fontSize: 15, fontWeight: 600, marginBottom: 12 }}>
              程序未签名，无法启动
            </div>
            <div style={{ fontSize: 13, marginBottom: 8 }}>
              <strong>路径：</strong>
              <code
                style={{
                  display: "block",
                  marginTop: 4,
                  padding: 8,
                  background: "var(--cx-surface-base)",
                  borderRadius: 4,
                  wordBreak: "break-all",
                  fontSize: 12,
                }}
              >
                {pinPrompt.program}
              </code>
            </div>
            <div style={{ fontSize: 13, marginBottom: 8, color: "var(--cx-text-content)" }}>
              <strong>原因：</strong>
              {pinPrompt.reason}
            </div>
            {pinError && (
              <div
                style={{
                  fontSize: 12,
                  marginBottom: 8,
                  color: "var(--cx-accent-signal, #c0392b)",
                }}
              >
                信任失败：{pinError}
              </div>
            )}
            <div style={{ fontSize: 12, marginBottom: 16, color: "var(--cx-text-content)" }}>
              信任后将记录此程序的 SHA-256 哈希，后续启动不再拦截。仅信任你确认安全的程序。
            </div>
            <div style={{ display: "flex", gap: 8, justifyContent: "flex-end" }}>
              <button
                type="button"
                onClick={handlePinCancel}
                disabled={pinning}
                style={{
                  padding: "8px 16px",
                  background: "var(--cx-surface-chrome)",
                  border: "1px solid var(--cx-line-hairline)",
                  borderRadius: 4,
                  color: "var(--cx-text-primary)",
                  cursor: pinning ? "not-allowed" : "pointer",
                  fontSize: 13,
                }}
              >
                取消
              </button>
              <button
                type="button"
                onClick={handlePinAndRetry}
                disabled={pinning || !pinPrompt.pinnable}
                style={{
                  padding: "8px 16px",
                  background: "var(--cx-accent-signal)",
                  border: "1px solid var(--cx-accent-signal)",
                  borderRadius: 4,
                  color: "#fff",
                  cursor: pinning ? "not-allowed" : "pointer",
                  fontSize: 13,
                  opacity: pinning ? 0.6 : 1,
                }}
              >
                {pinning ? "信任中…" : "信任并启动"}
              </button>
            </div>
          </div>
        </div>
      )}
    </WindowFrame>
  );
}
