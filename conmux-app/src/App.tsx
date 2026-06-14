import { useCallback, useRef, useState } from "react";
import {
  XtermTerminal,
  type ProcessExitedPayload,
} from "@conmux/terminal-core";

// M② 单 pane 端到端（D-6）：instanceId / adapterId 硬编为后端 spawn 的固定 pane
// （lib.rs PANE_ID="conmux-default" / ADAPTER_ID="pwsh"）。XtermTerminal 零改动复用：
//   interactive       → 键入经 inject_stdin 回传到 daemon pane stdin
//   subscribeToPty    → 拉 get_pty_history 重放 + 订阅 conmux://pty-output live 流
//   onPtyExit         → 退出态前端自管（terminal-core agent 无关，宿主拥有退出态）
//   isExitDetected    → 轮询去重读本地退出态
const INSTANCE_ID = "conmux-default";
const ADAPTER_ID = "pwsh";

export default function App() {
  // 退出态由宿主（conmux-app）拥有：onPtyExit 写、isExitDetected 读（D-6）。
  const [exitInfo, setExitInfo] = useState<ProcessExitedPayload | null>(null);
  // ref 镜像：轮询闭包读最新值（避免 stale 闭包），与 conflux agentStore 同策略。
  const exitedRef = useRef(false);

  const handlePtyExit = useCallback((payload: ProcessExitedPayload) => {
    exitedRef.current = true;
    setExitInfo(payload);
  }, []);

  const isExitDetected = useCallback(() => exitedRef.current, []);

  return (
    <div
      style={{
        height: "100vh",
        width: "100vw",
        display: "flex",
        flexDirection: "column",
        background: "#1E2030",
        boxSizing: "border-box",
      }}
    >
      <div style={{ flex: 1, minHeight: 0, position: "relative" }}>
        <XtermTerminal
          instanceId={INSTANCE_ID}
          adapterId={ADAPTER_ID}
          interactive
          subscribeToPty
          onPtyExit={handlePtyExit}
          isExitDetected={isExitDetected}
        />
      </div>
      {exitInfo && (
        <div
          style={{
            padding: "6px 14px",
            fontFamily: "'JetBrains Mono', monospace",
            fontSize: 12,
            color: "#F4DBD6",
            background: "rgba(120, 18, 18, 0.55)",
            borderTop: "1px solid rgba(255, 99, 99, 0.3)",
          }}
        >
          进程已退出
          {exitInfo.exit_code !== null ? `（exit code ${exitInfo.exit_code}）` : ""}
        </div>
      )}
    </div>
  );
}
