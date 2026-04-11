// ===== DiscussionPanel =====
// Light-theme side panel mirroring design/conflux.pen frame `6MjvR` (480×800).
// Slides in from the right edge; anchored to a specific agent instance.
// C1: static mock messages. Pretext-powered virtual scroll comes in C2.

import { type FC, useEffect, useMemo, useRef, useState } from "react";
import { useAgentStore } from "@/stores/agentStore";

// ===== Palette (light theme — intentionally contrasts the dark workspace) =====

const COLORS = {
  surfaceLightPrimary: "#FAFAF9",
  surfaceLightSecondary: "#F2F2EF",
  borderLight: "rgba(0,0,0,0.085)",
  textLightPrimary: "#1A1A1A",
  textLightBody: "#333333",
  textLightMuted: "#8A8A88",
  accentPrimary: "#B8D4E3",
  semanticWarning: "#FFB800",
};

// ===== Types =====

interface DiscussionMessage {
  id: string;
  authorKind: "agent" | "user";
  authorName: string;
  initials: string;
  avatarBg: string;
  avatarTextColor: string;
  time: string;
  body: string;
}

interface MemberAvatar {
  initials: string;
  bg: string;
}

// ===== Mock data =====
// Seeded to match the Pencil frame content exactly so QA can visual-diff.

const MOCK_MEMBERS: MemberAvatar[] = [
  { initials: "CC", bg: COLORS.accentPrimary },
  { initials: "CX", bg: COLORS.semanticWarning },
  { initials: "U", bg: COLORS.textLightMuted },
];

function buildMockMessages(adapterName: string): DiscussionMessage[] {
  return [
    {
      id: "m1",
      authorKind: "agent",
      authorName: adapterName || "Claude Code",
      initials: "CC",
      avatarBg: COLORS.accentPrimary,
      avatarTextColor: "#FFFFFF",
      time: "2m ago",
      body: "I've finished implementing the Canvas component with drag-and-drop. The LayoutManager still needs grid snapping — should I handle that or pass it to another agent?",
    },
    {
      id: "m2",
      authorKind: "agent",
      authorName: "Codex",
      initials: "CX",
      avatarBg: COLORS.semanticWarning,
      avatarTextColor: "#FFFFFF",
      time: "1m ago",
      body: "I can take the grid snapping. My analysis shows the layout uses a 12-column grid system, so snapping points should align to column boundaries.",
    },
    {
      id: "m3",
      authorKind: "user",
      authorName: "You",
      initials: "U",
      avatarBg: "#1A1A1A",
      avatarTextColor: "#FFFFFF",
      time: "just now",
      body: "Sounds good. Codex handles grid snapping, Claude Code moves to the AgentCard component next.",
    },
  ];
}

// ===== Icons =====

const IconSettings: FC = () => (
  <svg width={18} height={18} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
    <path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 0 1 0 2.83 2 2 0 0 1-2.83 0l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-2 2 2 2 0 0 1-2-2v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 0 1-2.83 0 2 2 0 0 1 0-2.83l.06-.06a1.65 1.65 0 0 0 .33-1.82 1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1-2-2 2 2 0 0 1 2-2h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 0 1 0-2.83 2 2 0 0 1 2.83 0l.06.06a1.65 1.65 0 0 0 1.82.33H9a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 2-2 2 2 0 0 1 2 2v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 0 1 2.83 0 2 2 0 0 1 0 2.83l-.06.06a1.65 1.65 0 0 0-.33 1.82V9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 2 2 2 2 0 0 1-2 2h-.09a1.65 1.65 0 0 0-1.51 1z" />
    <circle cx="12" cy="12" r="3" />
  </svg>
);

const IconArrowUp: FC = () => (
  <svg width={18} height={18} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
    <path d="M12 19V5M5 12l7-7 7 7" />
  </svg>
);

const IconX: FC = () => (
  <svg width={16} height={16} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
    <path d="M18 6 6 18M6 6l12 12" />
  </svg>
);

// ===== Component =====

const DiscussionPanel: FC = () => {
  const instanceId = useAgentStore((s) => s.discussionOpenForInstanceId);
  const close = useAgentStore((s) => s.closeDiscussion);
  const instance = useAgentStore((s) =>
    instanceId ? s.instances.get(instanceId) : undefined
  );

  const [draft, setDraft] = useState("");
  const [sending, setSending] = useState(false);
  const inputRef = useRef<HTMLTextAreaElement>(null);

  const messages = useMemo(
    () => buildMockMessages(instance?.adapter_name ?? ""),
    [instance?.adapter_name]
  );

  // ESC to close — stop propagation so ExpandedAgentCard's window-level
  // listener doesn't also fire and collapse the card underneath us.
  useEffect(() => {
    if (!instanceId) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        e.stopImmediatePropagation();
        close();
      }
    };
    window.addEventListener("keydown", onKey, true);
    return () => window.removeEventListener("keydown", onKey, true);
  }, [instanceId, close]);

  // Auto-focus input on open (after slide-in animation settles)
  useEffect(() => {
    if (!instanceId) return;
    const t = setTimeout(() => inputRef.current?.focus(), 320);
    return () => clearTimeout(t);
  }, [instanceId]);

  if (!instanceId) return null;

  const handleSend = () => {
    if (!draft.trim() || sending) return;
    setSending(true);
    // C1: mock send — simply clear the draft. C2 will wire to backend.
    setTimeout(() => {
      setDraft("");
      setSending(false);
      inputRef.current?.focus();
    }, 160);
  };

  const handleKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if ((e.ctrlKey || e.metaKey) && e.key === "Enter") {
      e.preventDefault();
      handleSend();
    }
  };

  return (
    <div
      className="fixed inset-y-0 right-0 z-45 flex"
      role="dialog"
      aria-modal="false"
      aria-label="Discussion"
      style={{ pointerEvents: "none" }}
    >
      <div
        className="discussion-panel-enter flex flex-col shrink-0 overflow-hidden"
        style={{
          width: 480,
          height: "100%",
          background: COLORS.surfaceLightPrimary,
          borderLeft: `1px solid ${COLORS.borderLight}`,
          boxShadow: "-16px 0 48px rgba(0,0,0,0.25), -4px 0 12px rgba(0,0,0,0.15)",
          pointerEvents: "auto",
        }}
      >
        {/* ===== Header (56) ===== */}
        <div
          className="flex items-center shrink-0"
          style={{
            height: 56,
            padding: "0 20px",
            gap: 10,
            background: COLORS.surfaceLightPrimary,
            borderBottom: `1px solid ${COLORS.borderLight}`,
          }}
        >
          <h2
            style={{
              fontFamily: "'Fraunces Variable', Georgia, serif",
              fontSize: 22,
              fontWeight: 700,
              color: COLORS.textLightPrimary,
              letterSpacing: -0.3,
              margin: 0,
            }}
          >
            Discussion
          </h2>
          <div className="flex-1" />
          {/* Members — absolute stacked avatars */}
          <div className="shrink-0 relative" style={{ width: 72, height: 28 }}>
            {MOCK_MEMBERS.map((m, i) => (
              <div
                key={m.initials}
                className="absolute flex items-center justify-center"
                style={{
                  left: i * 20,
                  top: 0,
                  width: 28,
                  height: 28,
                  borderRadius: 9999,
                  background: m.bg,
                  border: `2px solid ${COLORS.surfaceLightPrimary}`,
                }}
              >
                <span
                  style={{
                    fontFamily: "'Geist Sans',sans-serif",
                    fontSize: 10,
                    fontWeight: 700,
                    color: "#FFFFFF",
                    letterSpacing: 0.2,
                  }}
                >
                  {m.initials}
                </span>
              </div>
            ))}
          </div>
          <button
            className="shrink-0 flex items-center justify-center"
            style={{
              width: 28,
              height: 28,
              borderRadius: 6,
              color: COLORS.textLightMuted,
            }}
            title="Discussion settings"
            aria-label="Discussion settings"
          >
            <IconSettings />
          </button>
          <button
            className="shrink-0 flex items-center justify-center"
            style={{
              width: 28,
              height: 28,
              borderRadius: 6,
              color: COLORS.textLightMuted,
            }}
            onClick={close}
            title="Close (Esc)"
            aria-label="Close"
          >
            <IconX />
          </button>
        </div>

        {/* ===== Chat body (scrollable) ===== */}
        <div
          className="flex-1 min-h-0 overflow-y-auto"
          style={{
            padding: 20,
            display: "flex",
            flexDirection: "column",
            gap: 16,
            background: COLORS.surfaceLightPrimary,
          }}
        >
          {messages.map((msg, idx) => (
            <div key={msg.id} className="flex flex-col" style={{ gap: 16 }}>
              <div className="flex items-start" style={{ gap: 10 }}>
                {/* Avatar */}
                <div
                  className="shrink-0 flex items-center justify-center"
                  style={{
                    width: 32,
                    height: 32,
                    borderRadius: 9999,
                    background: msg.avatarBg,
                  }}
                >
                  <span
                    style={{
                      fontFamily: "'Geist Sans',sans-serif",
                      fontSize: msg.authorKind === "user" ? 13 : 11,
                      fontWeight: 700,
                      color: msg.avatarTextColor,
                      letterSpacing: 0.2,
                    }}
                  >
                    {msg.initials}
                  </span>
                </div>
                {/* Body */}
                <div className="flex flex-col flex-1 min-w-0" style={{ gap: 6 }}>
                  <div className="flex items-center" style={{ gap: 8 }}>
                    <span
                      style={{
                        fontFamily: "'Geist Sans',sans-serif",
                        fontSize: 13,
                        fontWeight: 600,
                        color: COLORS.textLightPrimary,
                      }}
                    >
                      {msg.authorName}
                    </span>
                    {msg.authorKind === "user" && (
                      <span
                        style={{
                          padding: "1px 6px",
                          borderRadius: 9999,
                          background: COLORS.textLightPrimary,
                          color: COLORS.surfaceLightPrimary,
                          fontFamily: "'Geist Sans',sans-serif",
                          fontSize: 9,
                          fontWeight: 600,
                          letterSpacing: 0.3,
                        }}
                      >
                        YOU
                      </span>
                    )}
                    <span
                      style={{
                        fontFamily: "'Geist Sans',sans-serif",
                        fontSize: 11,
                        color: COLORS.textLightMuted,
                      }}
                    >
                      {msg.time}
                    </span>
                  </div>
                  <p
                    style={{
                      fontFamily: "'Geist Sans',sans-serif",
                      fontSize: 14,
                      lineHeight: 1.6,
                      color: COLORS.textLightBody,
                      margin: 0,
                      wordBreak: "break-word",
                    }}
                  >
                    {msg.body}
                  </p>
                </div>
              </div>
              {idx < messages.length - 1 && (
                <div style={{ height: 1, background: COLORS.borderLight }} />
              )}
            </div>
          ))}
        </div>

        {/* ===== Input bar (56) ===== */}
        <div
          className="flex items-center shrink-0"
          style={{
            height: 56,
            padding: "10px 16px",
            gap: 10,
            background: COLORS.surfaceLightPrimary,
            borderTop: `1px solid ${COLORS.borderLight}`,
          }}
        >
          <div
            className="flex-1 min-w-0 flex items-center"
            style={{
              height: 36,
              padding: "0 14px",
              borderRadius: 12,
              background: COLORS.surfaceLightSecondary,
              border: `1px solid ${COLORS.borderLight}`,
            }}
          >
            <textarea
              ref={inputRef}
              value={draft}
              onChange={(e) => setDraft(e.target.value)}
              onKeyDown={handleKeyDown}
              placeholder="Type a message to the discussion..."
              rows={1}
              className="flex-1 min-w-0 resize-none bg-transparent outline-none"
              style={{
                fontFamily: "'Geist Sans',sans-serif",
                fontSize: 13,
                lineHeight: 1.5,
                color: COLORS.textLightPrimary,
                border: "none",
                padding: 0,
              }}
            />
          </div>
          <button
            onClick={handleSend}
            disabled={!draft.trim() || sending}
            className="shrink-0 flex items-center justify-center"
            style={{
              width: 36,
              height: 36,
              borderRadius: 9999,
              background: COLORS.textLightPrimary,
              color: COLORS.surfaceLightPrimary,
              opacity: !draft.trim() || sending ? 0.35 : 1,
              transition: "opacity 0.15s ease",
            }}
            title="Send (Ctrl+Enter)"
            aria-label="Send"
          >
            <IconArrowUp />
          </button>
        </div>
      </div>
    </div>
  );
};

export { DiscussionPanel };
