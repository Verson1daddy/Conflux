// ===== ExitOverlay =====
// C2-T1 Exit Overlay · Pencil 设计稿 `qnsSd` 的 React 实现。
//
// 触发条件：
//   XtermTerminal 订阅 conflux://process-exited，收到自己 instance 的 exit
//   事件时把 overlay 挂到 hostRef 上。overlay 只盖住 terminal 区域（卡片
//   的 header / footer 依旧可交互），给用户三个出口：
//     ↻ Restart Claude  — 用原 adapter 重启（respawn restart）
//     ▶ Open Shell      — 切换到 powershell（respawn shell）
//     × Close Card      — 彻底销毁卡片（走现有 destroy 路径）
//
// 键盘快捷键：
//   Enter = Restart（最常用）
//   S     = Open Shell
//   ESC   = Close Card（最弱 action，但也是最自然的"放弃这张卡"手势）

import { type FC, useCallback, useEffect } from "react";
import type { ProcessExitedPayload } from "@/types";

// ===== Palette (matches Pencil qnsSd tokens) =====

const COLORS = {
  scrim: "rgba(5,5,7,0.75)",
  panelBg: "#12171F",
  panelBorder: "rgba(255,255,255,0.12)",
  panelShadow: "0 18px 48px rgba(0,0,0,0.66), 0 0 0 1px rgba(255,255,255,0.04) inset",
  textPrimary: "#F2F2F2",
  textMuted: "#6B7280",
  accent: "#B8D4E3",
  dangerBg: "rgba(255,59,48,0.09)",
  dangerAccent: "#FF6B6B",
  divider: "rgba(255,255,255,0.07)",
  ghostBg: "rgba(255,255,255,0.03)",
  ghostBorder: "rgba(255,255,255,0.12)",
};

interface ExitOverlayProps {
  /** The exit event payload from the backend. `adapter_id = "__shell__"`
   *  means the card is already in shell mode — hide the Open Shell button
   *  because respawn shell → shell is a no-op. */
  payload: ProcessExitedPayload;
  /** Adapter display name ("Claude Code", "Shell", etc.) sourced from
   *  the card's own metadata — payload.adapter_id is the machine id. */
  adapterName: string;
  /** User picks an action. Parent component (XtermTerminal) forwards it
   *  to the respawn / destroy bridge. */
  onAction: (action: "restart" | "shell" | "close") => void;
}

const SHELL_ADAPTER_PSEUDO_ID = "__shell__";

// ===== Inline lucide-style icons =====

const IconPowerOff: FC<{ size?: number; color?: string }> = ({ size = 14, color = "currentColor" }) => (
  <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke={color} strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round">
    <path d="M18.36 6.64A9 9 0 0 1 20.77 15" />
    <path d="M6.16 6.16a9 9 0 1 0 12.68 12.68" />
    <path d="M12 2v4" />
    <line x1="2" x2="22" y1="2" y2="22" />
  </svg>
);

const IconRefreshCw: FC<{ size?: number; color?: string }> = ({ size = 14, color = "currentColor" }) => (
  <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke={color} strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
    <path d="M3 12a9 9 0 0 1 15-6.7L21 8" />
    <path d="M21 3v5h-5" />
    <path d="M21 12a9 9 0 0 1-15 6.7L3 16" />
    <path d="M8 16H3v5" />
  </svg>
);

const IconTerminal: FC<{ size?: number; color?: string }> = ({ size = 14, color = "currentColor" }) => (
  <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke={color} strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
    <path d="m7 11 2-2-2-2" />
    <path d="M11 13h4" />
    <rect width="18" height="18" x="3" y="3" rx="2" ry="2" />
  </svg>
);

const IconX: FC<{ size?: number; color?: string }> = ({ size = 14, color = "currentColor" }) => (
  <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke={color} strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
    <path d="M18 6 6 18M6 6l12 12" />
  </svg>
);

// ===== Subtitle helper =====

function formatSubtitle(payload: ProcessExitedPayload): string {
  const parts: string[] = [];
  if (payload.exit_code !== null) {
    parts.push(`Exit code ${payload.exit_code}`);
  } else {
    parts.push("Exited");
  }
  if (payload.signal === "pipe_broken") {
    parts.push("pipe broken");
  } else if (payload.signal) {
    parts.push(payload.signal);
  } else {
    parts.push("interrupted by ^C");
  }
  return parts.join(" · ");
}

// ===== Component =====

export const ExitOverlay: FC<ExitOverlayProps> = ({
  payload,
  adapterName,
  onAction,
}) => {
  const isAlreadyShell = payload.adapter_id === SHELL_ADAPTER_PSEUDO_ID;

  const handleRestart = useCallback(() => onAction("restart"), [onAction]);
  const handleShell = useCallback(() => onAction("shell"), [onAction]);
  const handleClose = useCallback(() => onAction("close"), [onAction]);

  // Keyboard shortcuts while overlay is visible. Capture phase so we
  // intercept before xterm's own listeners (xterm is disabled anyway when
  // the overlay mounts but we want to be safe under future interactions).
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Enter") {
        e.preventDefault();
        e.stopPropagation();
        handleRestart();
      } else if (e.key === "Escape") {
        e.preventDefault();
        e.stopPropagation();
        handleClose();
      } else if (e.key === "s" || e.key === "S") {
        if (!isAlreadyShell) {
          e.preventDefault();
          e.stopPropagation();
          handleShell();
        }
      }
    };
    window.addEventListener("keydown", onKey, true);
    return () => window.removeEventListener("keydown", onKey, true);
  }, [handleRestart, handleShell, handleClose, isAlreadyShell]);

  return (
    <div
      className="absolute inset-0 flex items-center justify-center"
      style={{
        background: COLORS.scrim,
        backdropFilter: "blur(6px)",
        WebkitBackdropFilter: "blur(6px)",
        // Terminal panel sits inside the card's flex body; overlay catches
        // all pointer events so background xterm is frozen.
        zIndex: 10,
        animation: "exit-overlay-enter 0.22s cubic-bezier(0.22, 1, 0.36, 1)",
      }}
      role="dialog"
      aria-modal="true"
      aria-labelledby="exit-overlay-title"
    >
      <div
        className="flex flex-col"
        style={{
          width: 360,
          maxWidth: "86%",
          padding: "24px 24px 20px 24px",
          gap: 16,
          background: COLORS.panelBg,
          borderRadius: 16,
          border: `1px solid ${COLORS.panelBorder}`,
          boxShadow: COLORS.panelShadow,
        }}
      >
        {/* Header: red dot-bg icon + title */}
        <div className="flex items-center" style={{ gap: 10 }}>
          <div
            className="flex items-center justify-center shrink-0"
            style={{
              width: 26,
              height: 26,
              borderRadius: 9999,
              background: COLORS.dangerBg,
              color: COLORS.dangerAccent,
            }}
          >
            <IconPowerOff size={14} />
          </div>
          <span
            id="exit-overlay-title"
            style={{
              fontFamily: "'Fraunces Variable','Fraunces',Georgia,serif",
              fontSize: 17,
              fontWeight: 600,
              color: COLORS.textPrimary,
              letterSpacing: -0.2,
            }}
          >
            {adapterName} exited
          </span>
        </div>

        {/* Subtitle */}
        <span
          style={{
            fontFamily: "'Geist Sans',sans-serif",
            fontSize: 12,
            fontWeight: 400,
            color: COLORS.textMuted,
            lineHeight: 1.4,
          }}
        >
          {formatSubtitle(payload)}
        </span>

        {/* Divider */}
        <div style={{ height: 1, background: COLORS.divider }} />

        {/* Actions */}
        <div className="flex flex-col" style={{ gap: 8 }}>
          {/* Restart — accent solid pill, primary action */}
          <button
            onClick={handleRestart}
            className="flex items-center justify-center transition-opacity"
            style={{
              height: 40,
              gap: 8,
              borderRadius: 9999,
              background: COLORS.accent,
              color: "#0A0F15",
              fontFamily: "'Geist Sans',sans-serif",
              fontSize: 13,
              fontWeight: 600,
              border: "none",
              cursor: "pointer",
            }}
            aria-label="Restart agent"
            title="Restart (Enter)"
          >
            <IconRefreshCw size={14} color="#0A0F15" />
            <span>Restart {adapterName}</span>
          </button>

          {/* Open Shell — ghost pill with border, only if not already shell */}
          {!isAlreadyShell && (
            <button
              onClick={handleShell}
              className="flex items-center justify-center transition-colors"
              style={{
                height: 40,
                gap: 8,
                borderRadius: 9999,
                background: COLORS.ghostBg,
                color: COLORS.textPrimary,
                fontFamily: "'Geist Sans',sans-serif",
                fontSize: 13,
                fontWeight: 500,
                border: `1px solid ${COLORS.ghostBorder}`,
                cursor: "pointer",
              }}
              aria-label="Open shell"
              title="Open Shell (S)"
            >
              <IconTerminal size={14} color={COLORS.textPrimary} />
              <span>Open Shell</span>
            </button>
          )}

          {/* Close Card — weakest visual, muted text button */}
          <button
            onClick={handleClose}
            className="flex items-center justify-center transition-colors"
            style={{
              height: 36,
              gap: 8,
              borderRadius: 9999,
              background: "transparent",
              color: COLORS.textMuted,
              fontFamily: "'Geist Sans',sans-serif",
              fontSize: 12,
              fontWeight: 500,
              border: "none",
              cursor: "pointer",
            }}
            aria-label="Close card"
            title="Close Card (Esc)"
          >
            <IconX size={14} color={COLORS.textMuted} />
            <span>Close Card</span>
          </button>
        </div>
      </div>
    </div>
  );
};
