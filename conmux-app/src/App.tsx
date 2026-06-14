import { useCallback, useEffect, useRef, useState } from "react";
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
import { SessionObserver } from "./observe/session-observer";
import {
  applyChromeVars,
  cycleStyle,
  getCurrentStyle,
  initStyles,
} from "./lib/style";
import { useStyle } from "./lib/useStyle";
import {
  deriveSessionStatus,
  type SessionState,
} from "./chrome/session-status";

// M② 单 pane 端到端（D-6）：instanceId / adapterId 硬编为后端 spawn 的固定 pane
// （lib.rs PANE_ID="conmux-default" / ADAPTER_ID="pwsh"）。XtermTerminal 零改动复用：
//   interactive       → 键入经 inject_stdin 回传到 daemon pane stdin
//   subscribeToPty    → 拉 get_pty_history 重放 + 订阅 conmux://pty-output live 流
//   onPtyExit         → 退出态前端自管（terminal-core agent 无关，宿主拥有退出态）
//   isExitDetected    → 轮询去重读本地退出态
//
// M③ 壳升级：把裸终端包进 Paper Terminal 壳——缩点条（顶）+ pane（中）+ 状态栏（底），
// 颜色全部走 chrome CSS 变量（绑 conmux Style）。换肤 = 换一组 chrome 变量 +
// setTerminalTheme(配对 terminal_theme_id) 让 xterm 协调跟随（复用 terminal-core 链）。
const INSTANCE_ID = "conmux-default";
const ADAPTER_ID = "pwsh";

export default function App() {
  // 退出态由宿主（conmux-app）拥有：onPtyExit 写、isExitDetected 读（D-6）。
  const [exitInfo, setExitInfo] = useState<ProcessExitedPayload | null>(null);
  // ref 镜像：轮询闭包读最新值（避免 stale 闭包），与 conflux agentStore 同策略。
  const exitedRef = useRef(false);
  // 当前风格（订阅 store；驱动 chrome 重渲染）。
  const style = useStyle();

  // M3-ext：会话观测者（与 XtermTerminal 并行挂在同一 daemon pane 上，不干扰终端渲染）。
  // 单例（绑 INSTANCE_ID=conmux-default），随 App 生命周期 start/stop；
  // 订阅 conmux://pty-output 喂 parser/OSC7 → 维护 AwareState 驱动 AwareHeader。
  const observerRef = useRef<SessionObserver | null>(null);
  if (observerRef.current === null) {
    observerRef.current = new SessionObserver(INSTANCE_ID);
  }
  const observer = observerRef.current;

  useEffect(() => {
    const stop = observer.start();
    return stop;
  }, [observer]);

  // 启动一次：先加载终端预置（chrome 换肤要按 terminal_theme_id 取 TerminalTheme
  // 喂 xterm），再加载风格列表；两者就绪后把当前风格的终端预置设进 terminal-core。
  useEffect(() => {
    let cancelled = false;
    void (async () => {
      // 顺序：先 themes（setTerminalTheme 校验 id 必须在已加载列表里），后 styles。
      await initTerminalThemes();
      await initStyles();
      if (cancelled) return;
      const current = getCurrentStyle();
      // 当前风格的配对终端预置喂 xterm（经 terminal-core 广播链，无需重挂载）。
      setTerminalTheme(current.terminal_theme_id);
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  // 风格变化（含初次）→ 写 chrome CSS 变量 + 取配对 TerminalTheme 喂 xterm。
  // 二者一起换，chrome 与终端永远协调（F1 边界一：两层共消费同一套语义 token）。
  useEffect(() => {
    applyChromeVars(style);
    setTerminalTheme(style.terminal_theme_id);
  }, [style]);

  const handlePtyExit = useCallback((payload: ProcessExitedPayload) => {
    exitedRef.current = true;
    setExitInfo(payload);
  }, []);

  const isExitDetected = useCallback(() => exitedRef.current, []);

  // 缩点条会话项（M③ 单 pane = 一个活跃 pill；dot 状态由退出信息启发式派生）。
  // ⚠️ MF-3：attention 脉冲是前端本地启发式占位，非控制面真路由（见 session-status.ts）。
  const sessions: SessionState[] = [
    {
      instanceId: INSTANCE_ID,
      name: "conmux",
      status: deriveSessionStatus(exitInfo),
      active: true,
    },
  ];

  const paneRunning = exitInfo === null;

  return (
    <WindowFrame>
      <TopBar sessions={sessions} />

      {/* aware-header（M3-ext）：缩点条与 pane 之间，显诚实观测的会话运行信息 + LLM 元数据。 */}
      <AwareHeader observer={observer} />

      {/* pane（body）：fill surface.base、padding [14,16]、flex 占满；内嵌真实 daemon pane。 */}
      <div
        style={{
          flex: 1,
          minHeight: 0,
          position: "relative",
          padding: "14px 16px",
          background: "var(--cx-surface-base)",
          boxSizing: "border-box",
        }}
      >
        <XtermTerminal
          instanceId={INSTANCE_ID}
          adapterId={ADAPTER_ID}
          interactive
          subscribeToPty
          onPtyExit={handlePtyExit}
          isExitDetected={isExitDetected}
        />
        {exitInfo && (
          <div
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
            {exitInfo.exit_code !== null
              ? `（exit code ${exitInfo.exit_code}）`
              : ""}
          </div>
        )}
      </div>

      <StatusBar
        paneCount={paneRunning ? 1 : 0}
        daemonConnected={paneRunning}
        styleName={style.name}
        onCycleStyle={cycleStyle}
      />
    </WindowFrame>
  );
}
