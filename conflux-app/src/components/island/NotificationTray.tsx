// ===== NotificationTray =====
// Dropdown panel below the TopBar capsule. Shows TaskCompleted notifications,
// each with an inline reply input that sends to the source agent's stdin.
// Matches design/conflux.pen frame "通知托盘展开" (4QbOf).

import { type FC, useEffect, useState, useCallback, useRef } from "react";
import { useIslandStore } from "@/stores/islandStore";
import { injectStdin } from "@/lib/tauri-bridge";
import type { NotificationItem, NotificationLevel } from "@/types";

interface NotificationTrayProps {
  visible: boolean;
  onClose: () => void;
}

// ===== Inline SVG icons =====

const ICON_X: FC<{ size: number }> = ({ size }) => (
  <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
    <path d="M18 6 6 18M6 6l12 12" />
  </svg>
);

const ICON_SEND: FC<{ size: number; color: string }> = ({ size, color }) => (
  <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke={color} strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
    <path d="M14.536 21.686a.5.5 0 0 0 .937-.024l6.5-19a.496.496 0 0 0-.635-.635l-19 6.5a.5.5 0 0 0-.024.937l7.93 3.18a2 2 0 0 1 1.112 1.11z" />
    <path d="m21.854 2.147-10.94 10.939" />
  </svg>
);

// ===== Helpers =====

const STATUS_COLORS: Record<NotificationLevel, string> = {
  info: "#34C759",
  warning: "#FFB800",
  error: "#FF3B30",
  permission_required: "#FFB800",
};

function formatRelativeTime(ts: number): string {
  const diff = Date.now() - ts;
  const sec = Math.floor(diff / 1000);
  if (sec < 60) return `${sec}s ago`;
  const min = Math.floor(sec / 60);
  if (min < 60) return `${min}m ago`;
  const hr = Math.floor(min / 60);
  return `${hr}h ago`;
}

// ===== NotificationCard sub-component =====

type RemovalState = "idle" | "success" | "dismiss";

interface NotificationCardProps {
  notif: NotificationItem;
  onDismiss: (id: string) => void;
  onReply: (notif: NotificationItem, reply: string) => Promise<void>;
  removalState: RemovalState;
}

const NotificationCard: FC<NotificationCardProps> = ({ notif, onDismiss, onReply, removalState }) => {
  const [reply, setReply] = useState("");
  const [sending, setSending] = useState(false);

  const agentName = notif.source_adapter_name || notif.source_instance_id || "Agent";
  const dotColor = STATUS_COLORS[notif.level] ?? "#6B7280";

  const handleSend = useCallback(async () => {
    if (!reply.trim() || sending) return;
    setSending(true);
    try {
      await onReply(notif, reply);
      setReply("");
    } finally {
      setSending(false);
    }
  }, [reply, sending, notif, onReply]);

  const handleKeyDown = useCallback((e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      handleSend();
    }
  }, [handleSend]);

  const animClass =
    removalState === "success"
      ? "notif-flash-success"
      : removalState === "dismiss"
        ? "notif-flash-dismiss"
        : "";

  return (
    <div
      className={`flex flex-col ${animClass}`}
      style={{
        padding: "14px 16px",
        gap: 10,
        borderRadius: 8,
        background: "rgba(255,255,255,0.04)",
        border: "1px solid rgba(255,255,255,0.082)",
      }}
    >
      {/* Header row */}
      <div className="flex items-center" style={{ gap: 8 }}>
        <span
          className="shrink-0 rounded-full"
          style={{ width: 8, height: 8, background: dotColor }}
        />
        <span
          style={{
            fontFamily: "'Geist Sans', sans-serif",
            fontSize: 13,
            fontWeight: 600,
            color: "#F2F2F2",
          }}
        >
          {agentName}
        </span>
        <span
          style={{
            fontFamily: "'Geist Sans', sans-serif",
            fontSize: 11,
            color: "#6B7280",
          }}
        >
          finished {formatRelativeTime(notif.created_at)}
        </span>
        <div className="flex-1" />
        <button
          onClick={() => onDismiss(notif.id)}
          className="shrink-0 transition-colors"
          style={{ color: "#6B7280" }}
          aria-label="Dismiss"
          title="Dismiss"
        >
          <ICON_X size={14} />
        </button>
      </div>

      {/* Message body */}
      <p
        style={{
          fontFamily: "'Geist Sans', sans-serif",
          fontSize: 12,
          color: "#B8B3B0",
          lineHeight: 1.6,
          margin: 0,
          whiteSpace: "pre-wrap",
        }}
      >
        {notif.content}
      </p>

      {/* Reply row */}
      <div className="flex items-center" style={{ gap: 8 }}>
        <div
          className="flex-1 min-w-0 flex items-center"
          style={{
            padding: "9px 12px",
            borderRadius: 8,
            background: "rgba(255,255,255,0.07)",
            border: "1px solid rgba(255,255,255,0.082)",
          }}
        >
          <input
            type="text"
            value={reply}
            onChange={(e) => setReply(e.target.value)}
            onKeyDown={handleKeyDown}
            disabled={sending}
            placeholder={`Reply to ${agentName}…`}
            className="w-full bg-transparent outline-none"
            style={{
              fontFamily: "'Geist Sans', sans-serif",
              fontSize: 12,
              color: "#F2F2F2",
            }}
          />
        </div>
        <button
          onClick={handleSend}
          disabled={!reply.trim() || sending}
          className="shrink-0 flex items-center transition-opacity"
          style={{
            padding: "9px 16px",
            gap: 6,
            borderRadius: 8,
            background: "#B8D4E3",
            fontFamily: "'Geist Sans', sans-serif",
            fontSize: 12,
            fontWeight: 600,
            color: "#0A0F15",
            opacity: !reply.trim() || sending ? 0.4 : 1,
            cursor: !reply.trim() || sending ? "not-allowed" : "pointer",
          }}
        >
          <ICON_SEND size={12} color="#0A0F15" />
          <span>Send</span>
        </button>
      </div>
    </div>
  );
};

// ===== NotificationTray main =====

const REMOVE_ANIMATION_MS = 360;

const NotificationTray: FC<NotificationTrayProps> = ({ visible, onClose }) => {
  const notifications = useIslandStore((s) => s.notifications);
  const clearNotification = useIslandStore((s) => s.clearNotification);
  const [removalMap, setRemovalMap] = useState<Map<string, RemovalState>>(new Map());

  // Esc to close
  useEffect(() => {
    if (!visible) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [visible, onClose]);

  // 通知清零时自动收起 tray（回完最后一条后无缝关闭）
  // 只在"从 >0 降到 0"的迁移时触发，避免"用户主动开空 tray"的场景被立即关掉。
  const prevCountRef = useRef(notifications.length);
  useEffect(() => {
    const prev = prevCountRef.current;
    const curr = notifications.length;
    if (visible && prev > 0 && curr === 0) {
      onClose();
    }
    prevCountRef.current = curr;
  }, [visible, notifications.length, onClose]);

  // 统一的"标记移除 → 等动画 → 清理 store"管线
  const animateRemoval = useCallback(
    async (id: string, state: RemovalState) => {
      setRemovalMap((prev) => {
        if (prev.get(id)) return prev; // 已在移除中，防止重复触发
        const next = new Map(prev);
        next.set(id, state);
        return next;
      });
      await new Promise((resolve) => setTimeout(resolve, REMOVE_ANIMATION_MS));
      clearNotification(id);
      setRemovalMap((prev) => {
        const next = new Map(prev);
        next.delete(id);
        return next;
      });
    },
    [clearNotification]
  );

  const handleDismiss = useCallback(
    (id: string) => {
      void animateRemoval(id, "dismiss");
    },
    [animateRemoval]
  );

  const handleReply = useCallback(
    async (notif: NotificationItem, replyText: string) => {
      // Try backend; ignore failure so demo still works
      try {
        await injectStdin(notif.source_instance_id, replyText + "\n", "user_direct");
      } catch { /* no PTY yet — demo mode */ }
      await animateRemoval(notif.id, "success");
    },
    [animateRemoval]
  );

  if (!visible) return null;

  return (
    <>
      {/* Backdrop — clicking closes tray */}
      <div
        className="fixed inset-0 z-40"
        style={{ background: "rgba(0,0,0,0.25)", backdropFilter: "blur(4px)", WebkitBackdropFilter: "blur(4px)" }}
        onClick={onClose}
        aria-hidden="true"
      />

      {/* Tray card — centered below the TopBar capsule */}
      <div
        className="fixed z-40 flex flex-col overflow-hidden tray-enter"
        style={{
          top: 60,
          left: "50%",
          transform: "translateX(-50%)",
          width: 560,
          maxHeight: "70vh",
          background: "rgba(255,255,255,0.04)",
          backdropFilter: "blur(24px)",
          WebkitBackdropFilter: "blur(24px)",
          border: "1px solid rgba(255,255,255,0.13)",
          borderRadius: 12,
          boxShadow: "0 16px 48px rgba(0,0,0,0.4), 0 0 0 1px rgba(255,255,255,0.04) inset",
        }}
        role="dialog"
        aria-label="Notifications"
      >
        {/* Header */}
        <div className="flex items-center shrink-0" style={{ padding: "18px 24px", gap: 12 }}>
          <h2
            style={{
              fontFamily: "'Fraunces Variable', Georgia, serif",
              fontSize: 18,
              fontWeight: 600,
              color: "#F2F2F2",
              letterSpacing: -0.2,
              margin: 0,
            }}
          >
            Notifications
          </h2>
          {notifications.length > 0 && (
            <span
              style={{
                padding: "2px 8px",
                borderRadius: 9999,
                background: "rgba(184,212,227,0.15)",
                fontFamily: "'Geist Sans', sans-serif",
                fontSize: 11,
                fontWeight: 600,
                color: "#B8D4E3",
              }}
            >
              {notifications.length}
            </span>
          )}
          <div className="flex-1" />
          <button
            onClick={onClose}
            className="shrink-0 flex items-center justify-center"
            style={{
              width: 28,
              height: 28,
              background: "rgba(255,255,255,0.07)",
              border: "1px solid rgba(255,255,255,0.082)",
              borderRadius: 8,
              color: "#6B7280",
            }}
            aria-label="Close"
          >
            <ICON_X size={14} />
          </button>
        </div>

        {/* Divider */}
        <div style={{ height: 1, background: "rgba(255,255,255,0.082)" }} />

        {/* List or empty state */}
        {notifications.length > 0 ? (
          <div
            className="flex-1 overflow-y-auto flex flex-col"
            style={{ padding: "16px", gap: 8 }}
          >
            {notifications.map((notif) => (
              <NotificationCard
                key={notif.id}
                notif={notif}
                onDismiss={handleDismiss}
                onReply={handleReply}
                removalState={removalMap.get(notif.id) ?? "idle"}
              />
            ))}
          </div>
        ) : (
          <div
            className="flex-1 flex flex-col items-center justify-center"
            style={{ padding: "48px 24px", gap: 12, minHeight: 180 }}
          >
            {/* Check-circle icon — neutral muted color */}
            <svg
              width={40}
              height={40}
              viewBox="0 0 24 24"
              fill="none"
              stroke="#6B7280"
              strokeWidth={1.4}
              strokeLinecap="round"
              strokeLinejoin="round"
              aria-hidden="true"
            >
              <path d="M21.801 10A10 10 0 1 1 17 3.335" />
              <path d="m9 11 3 3L22 4" />
            </svg>
            <div
              style={{
                fontFamily: "'Fraunces Variable', Georgia, serif",
                fontSize: 16,
                fontWeight: 600,
                color: "#B8B3B0",
                letterSpacing: -0.1,
              }}
            >
              All caught up
            </div>
            <div
              style={{
                fontFamily: "'Geist Sans', sans-serif",
                fontSize: 12,
                color: "#6B7280",
                textAlign: "center",
                maxWidth: 320,
                lineHeight: 1.6,
              }}
            >
              No pending notifications. New task completions will appear here.
            </div>
          </div>
        )}
      </div>
    </>
  );
};

export { NotificationTray };
