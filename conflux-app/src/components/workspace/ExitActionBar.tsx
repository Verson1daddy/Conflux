// ===== ExitActionBar =====
// 退出态 footer 动作条（质感批 Q3'，用户裁决方案二：chrome 母语）。
// 取代旧 ExitOverlay（悬浮玻璃片，已废）：pane 内容降透明度由宿主负责，
// 本组件只渲染 footer 升起的红调动作条。无全局键盘快捷键（旧 overlay 的
// window 级 Enter/ESC/S 会误伤多卡场景——审计 P2，顺势移除）。

import { type FC } from "react";
import type { ProcessExitedPayload } from "@/types";
import type { ExitAction } from "@/hooks/useExitActions";
import { Icon } from "@/components/ui/Icon";

const SHELL_ADAPTER_PSEUDO_ID = "__shell__";

/** 紧凑退出摘要："exit 1 · ^C · Claude Code" 风格。 */
function formatExitMessage(payload: ProcessExitedPayload): string {
  const parts: string[] = [];
  parts.push(payload.exit_code !== null ? `exit ${payload.exit_code}` : "exited");
  if (payload.signal === "pipe_broken") {
    parts.push("pipe broken");
  } else if (payload.signal) {
    parts.push(payload.signal);
  } else {
    parts.push("^C");
  }
  return parts.join(" · ");
}

interface ExitActionBarProps {
  payload: ProcessExitedPayload;
  onAction: (action: ExitAction) => void;
  /** 紧凑模式（预览卡 footer 32px）；展开态 footer 更宽裕。 */
  compact?: boolean;
}

const ExitActionBar: FC<ExitActionBarProps> = ({ payload, onAction, compact = false }) => {
  const isAlreadyShell = payload.adapter_id === SHELL_ADAPTER_PSEUDO_ID;
  const btnBase: React.CSSProperties = {
    height: compact ? 20 : 24,
    padding: compact ? "0 8px" : "0 11px",
    borderRadius: 6,
    fontSize: compact ? 10 : 10.5,
    cursor: "pointer",
    border: "1px solid rgba(184,212,227,0.22)",
    background: "rgba(184,212,227,0.05)",
    color: "rgba(255,255,255,0.8)",
    whiteSpace: "nowrap",
  };

  return (
    <div
      data-testid="exit-action-bar"
      className="flex items-center w-full"
      style={{ gap: 8, minWidth: 0 }}
      data-no-expand
    >
      <span
        className="truncate"
        style={{
          fontFamily: "'JetBrains Mono Variable',Consolas,monospace",
          fontSize: compact ? 9.5 : 10,
          color: "rgba(237,135,150,0.9)",
          display: "inline-flex",
          alignItems: "center",
          gap: 6,
          minWidth: 0,
        }}
        title={formatExitMessage(payload)}
      >
        <span
          style={{
            width: 5,
            height: 5,
            borderRadius: 1,
            background: "#ED8796",
            flexShrink: 0,
          }}
        />
        {formatExitMessage(payload)}
      </span>
      <span className="flex-1" />
      <button
        type="button"
        style={{
          ...btnBase,
          border: "1px solid rgba(184,212,227,0.55)",
          background: "rgba(184,212,227,0.16)",
          color: "#E3F1F8",
          fontWeight: 600,
          display: "inline-flex",
          alignItems: "center",
          gap: 4,
        }}
        onClick={(e) => {
          e?.stopPropagation();
          onAction("restart");
        }}
        aria-label="Restart agent"
      >
        <Icon name="refresh" size={compact ? 14 : 14} />
        Restart
      </button>
      {!isAlreadyShell && (
        <button
          type="button"
          style={btnBase}
          onClick={(e) => {
            e?.stopPropagation();
            onAction("shell");
          }}
          aria-label="Open shell in this card"
        >
          Shell
        </button>
      )}
      <button
        type="button"
        style={{
          ...btnBase,
          border: "1px solid transparent",
          background: "transparent",
          color: "rgba(255,255,255,0.4)",
          display: "inline-flex",
          alignItems: "center",
          gap: 4,
        }}
        onClick={(e) => {
          e?.stopPropagation();
          onAction("close");
        }}
        aria-label="Close card"
      >
        <Icon name="close" size={compact ? 14 : 14} />
        Close
      </button>
    </div>
  );
};

export { ExitActionBar };
export type { ExitActionBarProps };
