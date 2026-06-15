import {
  useCallback,
  useEffect,
  useReducer,
  useRef,
  useState,
  useSyncExternalStore,
} from "react";
import {
  XtermTerminal,
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
  getSessions,
  initSessions,
  removeSession,
  reopenRecent,
  setActive,
  subscribeSessions,
  type RecentEntry,
  type SessionEntry,
} from "./lib/sessions";
import { parseCommand, type LaunchEntry } from "./lib/launch-registry";
import { useLeaderKeyboard } from "./lib/leader";
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

  // ===== 会话 store 订阅 =====
  const sessions = useSyncExternalStore(subscribeSessions, getSessions);
  const activeId = useSyncExternalStore(subscribeSessions, getActiveId);

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
    const unsubs: Array<() => void> = [];
    for (const s of sessions) {
      if (!map.has(s.instanceId)) {
        const obs = new SessionObserver(s.instanceId);
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

  // 风格变化（含初次）→ 写 chrome CSS 变量 + 取配对 TerminalTheme 喂 xterm。
  useEffect(() => {
    applyChromeVars(style);
    setTerminalTheme(style.terminal_theme_id);
  }, [style]);

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

  // ===== leader 键盘仲裁（M⑤c §1）：capture 阶段 document keydown，tmux 式 Ctrl+Space 前缀 =====
  // 默认全透传（veto 级：仅 Ctrl+Space 被 conmux 取走）；armed 时下一个键解释为命令（切会话 /
  // 开面板 / leader-leader 送 NUL）后退待命。读 lib/sessions live 态，setPaletteOpen / armed
  // 徽章经 App state（hook 内部 ref 镜像最新回调，listener 一次装配无 stale）。
  useLeaderKeyboard({
    setPaletteOpen: (open) => setPaletteOpen(open),
    onArmedChange: setLeaderArmed,
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
    const status = aware ? deriveStatusFromAware(aware) : "running";
    return {
      instanceId: s.instanceId,
      name: s.launchName ?? s.name,
      status,
      active: s.instanceId === activeId,
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
  const handleSelect = useCallback((instanceId: string) => {
    setActive(instanceId);
  }, []);

  const handleCreate = useCallback(() => {
    void createSession().catch((e) => {
      // create 失败 fail-soft（不崩 UI）：记 console，缩点条不变。
      console.error("[conmux] 新建会话失败:", e);
    });
  }, []);

  // Home QUICK LAUNCH chip → parse 命令 → 起为新会话（D-1，携带 launchName）。
  const handleLaunch = useCallback((entry: LaunchEntry) => {
    const { program, args } = parseCommand(entry.command);
    void createSession({
      name: entry.name,
      program,
      args,
      ...(entry.cwd ? { cwd: entry.cwd } : {}),
    }).catch((e) => {
      console.error("[conmux] 快捷启动失败:", e);
    });
  }, []);

  // Home RECENT → 重开（parse 原命令 → 起为新会话，携带 launchName/cwd）。
  const handleReopenRecent = useCallback((entry: RecentEntry) => {
    void reopenRecent(entry).catch((e) => {
      console.error("[conmux] 重开会话失败:", e);
    });
  }, []);

  const handleClose = useCallback((instanceId: string) => {
    // 清退出态镜像（避免移除后残留）。
    exitedRef.current.delete(instanceId);
    setExitInfo((prev) => {
      if (!prev.has(instanceId)) return prev;
      const next = new Map(prev);
      next.delete(instanceId);
      return next;
    });
    void removeSession(instanceId);
  }, []);

  // active 会话的观测者（驱动 aware-header）。无会话时为 null。
  const activeObserver =
    activeId !== null ? observersRef.current.get(activeId) ?? null : null;

  return (
    <WindowFrame>
      <TopBar
        sessions={sessionStates}
        onSelect={handleSelect}
        onCreate={handleCreate}
        onClose={handleClose}
        styleName={style.name}
        onCycleStyle={cycleStyle}
      />

      {/* aware-header（M3-ext）：显当前 active 会话的诚实观测态。无会话时不渲染。 */}
      {activeObserver && <AwareHeader observer={activeObserver} />}

      {/* subagent 树（M3-ext-2）：当前 active 会话真实观测到的子 agent 派发树。
          subagents=[] 时组件自渲 null（诚实空，不占位）；仅 active 会话。 */}
      {activeObserver && <SubagentTree observer={activeObserver} />}

      {/* pane（body）：fill surface.base、flex 占满。padding [14,16] 落在每个 pane 层
          （mount-all 各 pane 绝对定位叠放，padding 在 pane 内以免与 body 重复）。
          mount-all（D-1）：每会话一个 XtermTerminal，CSS 仅显 active（保 live 态、切换零重连）。 */}
      <div
        data-testid="conmux-body"
        style={{
          flex: 1,
          minHeight: 0,
          position: "relative",
          background: "var(--cx-surface-base)",
          boxSizing: "border-box",
        }}
      >
        {sessions.map((s) => {
          const isActive = s.instanceId === activeId;
          const sExit = exitInfo.get(s.instanceId) ?? null;
          return (
            <div
              key={s.instanceId}
              data-testid={`conmux-pane-${s.instanceId}`}
              data-active={isActive ? "true" : "false"}
              style={{
                position: "absolute",
                inset: 0,
                padding: "14px 16px",
                // CSS 仅显 active：非 active 隐藏但保持挂载（live 终端态不丢、切换零重连）。
                display: isActive ? "block" : "none",
                boxSizing: "border-box",
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
        {/* 0 会话（降级态 / 全部关闭）→ Home 仪表盘（M⑤b D-2，替换 M④「无会话」兜底）：
            RECENT 重开 + QUICK LAUNCH 快捷启动 + 加项；不留空白、可一键起会话。 */}
        {sessions.length === 0 && (
          <Home
            sessionCount={sessions.length}
            daemonConnected={sessions.length > 0}
            running={homeRunning}
            onNewDefault={handleCreate}
            onLaunch={handleLaunch}
            onReopenRecent={handleReopenRecent}
          />
        )}
      </div>

      <StatusBar
        paneCount={sessions.length}
        daemonConnected={sessions.length > 0}
        leaderArmed={leaderArmed}
      />

      {/* 命令面板（M⑤a）：Ctrl+K 开（fixed scrim 覆盖全窗，DOM 末位不影响壳布局）。
          关时不挂载（条件渲染——卸载触发预览还原闭环兜底）。 */}
      {paletteOpen && (
        <CommandPalette
          open
          onClose={() => setPaletteOpen(false)}
        />
      )}
    </WindowFrame>
  );
}
