// ===== SendToPanel =====
// Proactive "Send to..." panel — the inverse of NotificationTray.
// Notification tray answers agents that already pinged us; SendToPanel
// lets the user push an ad-hoc message into any agent's stdin without
// waiting for a notification.
//
// Matches design/conflux.pen frame `EefOW` (600 wide, glass card):
//   Header: "Send to…" title + close button
//   Body:   RECIPIENT radio list (default = primary agent)
//           MESSAGE textarea
//           Footer: hint + Send pill
//
// Stdin injection uses source="user_direct" to match the notification
// tray flow; on success the panel closes and the input clears.

import { type FC, useEffect, useMemo, useRef, useState, useCallback } from "react";
import { useAgentStore } from "@/stores/agentStore";
import { injectStdin } from "@/lib/tauri-bridge";
import { PTY_ENTER } from "@/lib/constants";
import type { AgentInstanceInfo, AgentStatus } from "@/types";

// ===== Palette =====

const COLORS = {
  textPrimary: "#F2F2F2",
  textSecondary: "#B8B3B0",
  textMuted: "#6B7280",
  accent: "#B8D4E3",
  accentMuted: "rgba(184,212,227,0.15)",
  borderSoft: "rgba(255,255,255,0.082)",
  borderAccent: "rgba(184,212,227,0.5)",
  glassBg: "rgba(255,255,255,0.04)",
  glassBgHover: "rgba(255,255,255,0.07)",
  glassBorderStrong: "rgba(255,255,255,0.12)",
  success: "#34C759",
  warning: "#FFB800",
  error: "#FF3B30",
};

const STATUS_DOT: Record<AgentStatus, string> = {
  idle: COLORS.textMuted,
  thinking: COLORS.warning,
  coding: COLORS.success,
  waiting_permission: COLORS.warning,
  done: COLORS.success,
  error: COLORS.error,
};

// ===== Props =====

interface SendToPanelProps {
  visible: boolean;
  onClose: () => void;
}

// ===== Component =====

const SendToPanel: FC<SendToPanelProps> = ({ visible, onClose }) => {
  const instances = useAgentStore((s) => s.instances);

  // Derive ordered agent list — primary first, then by created_at desc.
  const agentList: AgentInstanceInfo[] = useMemo(() => {
    const arr = Array.from(instances.values());
    arr.sort((a, b) => {
      if (a.is_pinned !== b.is_pinned) {
        return a.is_pinned ? -1 : 1;
      }
      return (b.created_at ?? 0) - (a.created_at ?? 0);
    });
    return arr;
  }, [instances]);

  const primaryId = useMemo(
    () => agentList.find((a) => a.is_pinned)?.instance_id ?? agentList[0]?.instance_id ?? null,
    [agentList]
  );

  const [selectedId, setSelectedId] = useState<string | null>(primaryId);
  const [message, setMessage] = useState("");
  const [sending, setSending] = useState(false);
  const [flash, setFlash] = useState<"none" | "success" | "error">("none");
  const [errorMsg, setErrorMsg] = useState<string | null>(null);
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const prevVisibleRef = useRef(false);

  // Reset selection/message only on the false → true transition. Once the
  // panel is open, an external primary-agent change (e.g. Sidebar pin toggle)
  // must not overwrite whatever the user just picked.
  useEffect(() => {
    const opening = visible && !prevVisibleRef.current;
    prevVisibleRef.current = visible;
    if (!opening) return;
    setSelectedId(primaryId);
    setMessage("");
    setFlash("none");
    setErrorMsg(null);
    // Wait for the drop-in animation (0.26s) before stealing focus.
    const t = setTimeout(() => textareaRef.current?.focus(), 280);
    return () => clearTimeout(t);
  }, [visible, primaryId]);

  // ESC closes the panel
  useEffect(() => {
    if (!visible) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [visible, onClose]);

  const handleSend = useCallback(async () => {
    if (!selectedId || !message.trim() || sending) return;
    setSending(true);
    setFlash("none");
    setErrorMsg(null);
    try {
      await injectStdin(selectedId, message + PTY_ENTER, "user_direct");
      setFlash("success");
      setMessage("");
      setTimeout(() => {
        setFlash("none");
        onClose();
      }, 420);
    } catch (err) {
      // Surface the failure so production bugs don't silently vanish.
      setFlash("error");
      setErrorMsg(err instanceof Error ? err.message : String(err));
    } finally {
      setSending(false);
    }
  }, [selectedId, message, sending, onClose]);

  const handleKeyDown = useCallback(
    (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
      // Ctrl/Cmd + Enter sends; plain Enter inserts a newline.
      if ((e.ctrlKey || e.metaKey) && e.key === "Enter") {
        e.preventDefault();
        handleSend();
      }
    },
    [handleSend]
  );

  if (!visible) return null;

  const canSend = !!selectedId && message.trim().length > 0 && !sending;

  return (
    <div
      className="fixed inset-0 z-50 flex items-start justify-center"
      style={{
        background: "rgba(5,5,7,0.55)",
        backdropFilter: "blur(8px)",
        WebkitBackdropFilter: "blur(8px)",
      }}
      onClick={onClose}
    >
      <div
        className="flex flex-col overflow-hidden sendto-enter"
        style={{
          marginTop: 84,
          width: 560,
          maxWidth: "92vw",
          background: COLORS.glassBg,
          backdropFilter: "blur(24px)",
          WebkitBackdropFilter: "blur(24px)",
          border: `1px solid ${COLORS.glassBorderStrong}`,
          borderRadius: 16,
          boxShadow: "0 32px 80px rgba(0,0,0,0.55), 0 16px 48px rgba(0,0,0,0.4)",
        }}
        onClick={(e) => e.stopPropagation()}
      >
        {/* ===== Header ===== */}
        <div
          className="flex items-center"
          style={{
            padding: "20px 24px 16px 24px",
            gap: 12,
          }}
        >
          <span
            style={{
              fontFamily: "'Fraunces Variable','Fraunces',serif",
              fontSize: 20,
              fontWeight: 600,
              color: COLORS.textPrimary,
              letterSpacing: -0.2,
            }}
          >
            Send to…
          </span>
          <div className="flex-1" />
          <button
            className="flex items-center justify-center"
            style={{
              width: 28,
              height: 28,
              borderRadius: 8,
              background: COLORS.glassBgHover,
              border: `1px solid ${COLORS.borderSoft}`,
              color: COLORS.textMuted,
            }}
            onClick={onClose}
            title="Close (Esc)"
          >
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <path d="M18 6 6 18M6 6l12 12" />
            </svg>
          </button>
        </div>

        {/* Divider */}
        <div style={{ height: 1, background: COLORS.borderSoft }} />

        {/* ===== Body ===== */}
        <div
          className="flex flex-col"
          style={{
            padding: "16px 24px 20px 24px",
            gap: 14,
          }}
        >
          {/* RECIPIENT label */}
          <div
            style={{
              fontFamily: "'Geist Sans',sans-serif",
              fontSize: 10,
              fontWeight: 600,
              letterSpacing: 1.5,
              color: COLORS.textMuted,
            }}
          >
            RECIPIENT
          </div>

          {/* Agent radio list */}
          {agentList.length === 0 ? (
            <div
              className="text-center"
              style={{
                padding: "20px 0",
                fontFamily: "'Geist Sans',sans-serif",
                fontSize: 12,
                color: COLORS.textMuted,
              }}
            >
              No agents available.
            </div>
          ) : (
            <div className="flex flex-col" style={{ gap: 6 }}>
              {agentList.map((agent) => {
                const isSelected = agent.instance_id === selectedId;
                const dotColor = STATUS_DOT[agent.status] ?? COLORS.textMuted;
                return (
                  <button
                    key={agent.instance_id}
                    type="button"
                    className="flex items-center text-left"
                    title={`Select ${agent.display_name ? `${agent.adapter_name} · ${agent.display_name}` : agent.adapter_name} as recipient`}
                    style={{
                      padding: "10px 12px",
                      gap: 10,
                      borderRadius: 8,
                      background: isSelected ? COLORS.glassBgHover : COLORS.glassBg,
                      border: isSelected
                        ? `1px solid ${COLORS.borderAccent}`
                        : `1px solid ${COLORS.borderSoft}`,
                      cursor: "pointer",
                      transition: "background 0.15s, border-color 0.15s",
                    }}
                    onClick={() => setSelectedId(agent.instance_id)}
                  >
                    {/* Radio mark */}
                    <span
                      className="shrink-0 flex items-center justify-center"
                      style={{
                        width: 14,
                        height: 14,
                        borderRadius: 9999,
                        border: `1.5px solid ${isSelected ? COLORS.accent : COLORS.textMuted}`,
                        transition: "border-color 0.15s cubic-bezier(0.22, 1, 0.36, 1)",
                      }}
                    >
                      <span
                        style={{
                          width: 6,
                          height: 6,
                          borderRadius: 9999,
                          background: COLORS.accent,
                          transition: "transform 0.15s cubic-bezier(0.22, 1, 0.36, 1), opacity 0.15s",
                          transform: isSelected ? "scale(1)" : "scale(0)",
                          opacity: isSelected ? 1 : 0,
                        }}
                      />
                    </span>

                    {/* Status dot + agent name */}
                    <span
                      className="shrink-0 rounded-full"
                      style={{ width: 6, height: 6, background: dotColor }}
                    />
                    <span
                      className="truncate"
                      style={{
                        fontFamily: "'Geist Sans',sans-serif",
                        fontSize: 13,
                        fontWeight: 600,
                        color: COLORS.textPrimary,
                      }}
                    >
                      {agent.display_name ? `${agent.adapter_name} · ${agent.display_name}` : agent.adapter_name}
                    </span>

                    {/* Primary badge */}
                    {agent.is_pinned && (
                      <span
                        className="shrink-0"
                        style={{
                          fontFamily: "'Geist Sans',sans-serif",
                          fontSize: 10,
                          fontWeight: 500,
                          letterSpacing: 0.4,
                          color: COLORS.accent,
                          background: COLORS.accentMuted,
                          borderRadius: 9999,
                          padding: "2px 8px",
                        }}
                      >
                        primary
                      </span>
                    )}

                    <div className="flex-1" />

                    {/* Adapter id (monospaced hint) */}
                    <span
                      className="shrink-0"
                      style={{
                        fontFamily: "'JetBrains Mono Variable',monospace",
                        fontSize: 10,
                        color: COLORS.textMuted,
                      }}
                    >
                      {agent.adapter_id}
                    </span>
                  </button>
                );
              })}
            </div>
          )}

          {/* MESSAGE label */}
          <div
            style={{
              fontFamily: "'Geist Sans',sans-serif",
              fontSize: 10,
              fontWeight: 600,
              letterSpacing: 1.5,
              color: COLORS.textMuted,
              paddingTop: 4,
            }}
          >
            MESSAGE
          </div>

          {/* Textarea */}
          <div
            style={{
              background: COLORS.glassBgHover,
              border:
                flash === "success"
                  ? `1px solid ${COLORS.success}`
                  : flash === "error"
                    ? `1px solid ${COLORS.error}`
                    : `1px solid ${COLORS.borderSoft}`,
              borderRadius: 8,
              padding: "12px 14px",
              transition: "border-color 0.2s",
            }}
          >
            <textarea
              ref={textareaRef}
              value={message}
              onChange={(e) => setMessage(e.target.value)}
              onKeyDown={handleKeyDown}
              placeholder="Your message…"
              rows={4}
              className="w-full resize-none bg-transparent outline-none select-text"
              style={{
                fontFamily: "'Geist Sans',sans-serif",
                fontSize: 13,
                lineHeight: 1.55,
                color: COLORS.textPrimary,
                minHeight: 66,
              }}
            />
          </div>

          {/* Actions row */}
          <div className="flex items-center" style={{ gap: 10 }}>
            <span
              style={{
                fontFamily: "'Geist Sans',sans-serif",
                fontSize: 11,
                color: flash === "error" ? COLORS.error : COLORS.textMuted,
                maxWidth: 320,
                lineHeight: 1.4,
              }}
            >
              {flash === "error" && errorMsg
                ? `Send failed: ${errorMsg}`
                : (
                  <>
                    Sends to the selected agent's stdin ·{" "}
                    <kbd style={{ fontFamily: "'JetBrains Mono Variable',monospace", fontSize: 10, color: COLORS.textSecondary }}>Ctrl</kbd>
                    +
                    <kbd style={{ fontFamily: "'JetBrains Mono Variable',monospace", fontSize: 10, color: COLORS.textSecondary }}>Enter</kbd>
                  </>
                )}
            </span>
            <div className="flex-1" />
            <button
              type="button"
              disabled={!canSend}
              onClick={handleSend}
              className="flex items-center"
              title="Send message (Ctrl+Enter)"
              style={{
                gap: 6,
                padding: "10px 20px",
                borderRadius: 9999,
                background: canSend ? COLORS.accent : "rgba(184,212,227,0.25)",
                color: "#0A0F15",
                fontFamily: "'Geist Sans',sans-serif",
                fontSize: 12,
                fontWeight: 600,
                letterSpacing: 0.2,
                cursor: canSend ? "pointer" : "not-allowed",
                transition: "background 0.18s, transform 0.12s",
                transform: flash === "success" ? "scale(0.97)" : "scale(1)",
              }}
            >
              <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                <path d="M14.536 21.686a.5.5 0 0 0 .937-.024l6.5-19a.496.496 0 0 0-.635-.635l-19 6.5a.5.5 0 0 0-.024.937l7.93 3.18a2 2 0 0 1 1.112 1.11z" />
                <path d="m21.854 2.147-10.94 10.939" />
              </svg>
              <span>{sending ? "Sending…" : flash === "success" ? "Sent" : flash === "error" ? "Retry" : "Send"}</span>
            </button>
          </div>
        </div>
      </div>
    </div>
  );
};

export { SendToPanel };
export type { SendToPanelProps };
