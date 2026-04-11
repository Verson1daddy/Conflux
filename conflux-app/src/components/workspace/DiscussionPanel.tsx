// ===== DiscussionPanel — 4-step wizard + chatroom =====
// Light-theme side panel (480 wide) that slides in from the right.
// Step 1: Direction  → Step 2: Rules  → Step 3: Participants  → Step 4: Chatroom
// Mirrors design/conflux.pen frames (wizard steps replacing legacy 6MjvR).
// ESC priority: capture-phase handler stops propagation so ExpandedAgentCard
// underneath doesn't collapse. ESC on step 1-3 closes the wizard; on step 4
// (chatroom) closes only after End Discussion confirmation.

import { type FC, useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useAgentStore } from "@/stores/agentStore";
import type {
  DiscussionMessage,
  DiscussionStep,
  MessageStyle,
  TurnOrder,
} from "@/stores/agentStore";
import type { AgentInstanceInfo } from "@/types";

// ===== Palette (light theme — intentionally contrasts the dark workspace) =====

const COLORS = {
  surfacePanel:   "#FAF8F5",
  surfaceCardBg:  "#FFFFFF",
  surfaceInputBg: "#F5F0EB",
  border:         "#D4CFC9",
  borderHover:    "#B0ABA5",
  textPrimary:    "#1A1A1A",
  textBody:       "#5A5A5A",
  textMuted:      "#8A8A8A",
  accent:         "#B8D4E3",
  accentSoft:     "#E8F1F6",
  warning:        "#FFB800",
  warningBg:      "#FFF4DB",
  warningText:    "#9E6B00",
  danger:         "#FF3B30",
  dangerBg:       "#FDE8E6",
  dangerText:     "#C41E12",
};

const AVATAR_BY_ADAPTER: Record<string, string> = {
  "claude-code": COLORS.accent,
  "codex":       COLORS.warning,
  "aider":       "#8EA4B8",
  "opencode":    "#C9B894",
};

function initialsOf(name: string): string {
  const parts = name.trim().split(/\s+/);
  if (!parts.length) return "?";
  if (parts.length === 1) return parts[0].slice(0, 2).toUpperCase();
  return (parts[0][0] + parts[1][0]).toUpperCase();
}

// ===== Shared icon primitives (inline SVG) =====

interface IconProps { size?: number; className?: string }

const IconX: FC<IconProps> = ({ size = 16 }) => (
  <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
    <path d="M18 6 6 18M6 6l12 12" />
  </svg>
);
const IconArrowLeft: FC<IconProps> = ({ size = 14 }) => (
  <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
    <path d="M19 12H5M12 19l-7-7 7-7" />
  </svg>
);
const IconArrowRight: FC<IconProps> = ({ size = 14 }) => (
  <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
    <path d="M5 12h14M12 5l7 7-7 7" />
  </svg>
);
const IconArrowUp: FC<IconProps> = ({ size = 16 }) => (
  <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
    <path d="M12 19V5M5 12l7-7 7 7" />
  </svg>
);
const IconCheck: FC<IconProps> = ({ size = 18 }) => (
  <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round">
    <path d="M20 6 9 17l-5-5" />
  </svg>
);
const IconPause: FC<IconProps> = ({ size = 13 }) => (
  <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round">
    <rect x="6" y="4" width="4" height="16" rx="1"/>
    <rect x="14" y="4" width="4" height="16" rx="1"/>
  </svg>
);
const IconStop: FC<IconProps> = ({ size = 13 }) => (
  <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round">
    <rect x="5" y="5" width="14" height="14" rx="2"/>
  </svg>
);
const IconPlay: FC<IconProps> = ({ size = 13 }) => (
  <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round">
    <polygon points="6 3 20 12 6 21 6 3"/>
  </svg>
);

// ===== Pill step indicator (matches Pencil stepper) =====

const StepIndicator: FC<{ step: DiscussionStep; label: string }> = ({ step, label }) => (
  <div className="flex items-center shrink-0" style={{ gap: 8, padding: "14px 20px" }}>
    <div
      className="flex items-center"
      style={{
        padding: "4px 10px",
        borderRadius: 9999,
        background: COLORS.textPrimary,
      }}
    >
      <span style={{
        fontFamily: "'Geist Sans', sans-serif",
        fontSize: 10,
        fontWeight: 600,
        color: COLORS.surfacePanel,
      }}>
        Step {step} of 4
      </span>
    </div>
    <span style={{ width: 4, height: 4, borderRadius: 9999, background: COLORS.textMuted }} />
    <span style={{
      fontFamily: "'Geist Sans', sans-serif",
      fontSize: 12,
      fontWeight: 500,
      color: COLORS.textPrimary,
    }}>
      {label}
    </span>
  </div>
);

// ===== Header bar (title + optional back arrow + X) =====

interface HeaderProps {
  title: string;
  titleSubtitle?: string;
  onBack?: () => void;
  onClose: () => void;
}
const Header: FC<HeaderProps> = ({ title, titleSubtitle, onBack, onClose }) => (
  <div
    className="flex items-center shrink-0"
    style={{
      height: titleSubtitle ? 64 : 56,
      padding: onBack ? "0 16px 0 14px" : "0 16px 0 20px",
      gap: 10,
      background: COLORS.surfacePanel,
      borderBottom: `1px solid ${COLORS.border}`,
    }}
  >
    {onBack && (
      <button
        onClick={onBack}
        className="shrink-0 flex items-center justify-center"
        style={{ width: 28, height: 28, borderRadius: 6, color: COLORS.textMuted }}
        aria-label="Back"
        title="Back"
      >
        <IconArrowLeft size={18} />
      </button>
    )}
    <div className="flex flex-col flex-1 min-w-0" style={{ gap: 2 }}>
      <h2 style={{
        fontFamily: "'Fraunces Variable', Georgia, serif",
        fontSize: titleSubtitle ? 18 : 22,
        fontWeight: 700,
        color: COLORS.textPrimary,
        letterSpacing: -0.3,
        margin: 0,
        lineHeight: 1.1,
      }}>
        {title}
      </h2>
      {titleSubtitle && (
        <span style={{
          fontFamily: "'Geist Sans', sans-serif",
          fontSize: 11,
          fontWeight: 500,
          color: COLORS.textMuted,
        }}>
          {titleSubtitle}
        </span>
      )}
    </div>
    <button
      onClick={onClose}
      className="shrink-0 flex items-center justify-center"
      style={{ width: 28, height: 28, borderRadius: 6, color: COLORS.textMuted }}
      aria-label="Close"
      title="Close (Esc)"
    >
      <IconX size={16} />
    </button>
  </div>
);

// ===== Footer button row =====

interface FooterProps {
  leftLabel?: string;
  leftOnClick?: () => void;
  rightLabel: string;
  rightIcon?: "arrow" | "none";
  rightDisabled?: boolean;
  rightOnClick: () => void;
}
const Footer: FC<FooterProps> = ({ leftLabel, leftOnClick, rightLabel, rightIcon = "arrow", rightDisabled, rightOnClick }) => (
  <div
    className="flex items-center shrink-0"
    style={{
      height: 68,
      padding: "0 20px",
      justifyContent: "space-between",
      background: COLORS.surfacePanel,
      borderTop: `1px solid ${COLORS.border}`,
    }}
  >
    {leftLabel ? (
      <button
        onClick={leftOnClick}
        className="flex items-center"
        style={{
          height: 38,
          padding: "0 18px",
          gap: 8,
          borderRadius: 9999,
          background: COLORS.surfaceInputBg,
          border: `1px solid ${COLORS.border}`,
          fontFamily: "'Geist Sans', sans-serif",
          fontSize: 13,
          fontWeight: 500,
          color: COLORS.textBody,
          cursor: "pointer",
        }}
      >
        <IconArrowLeft />
        <span>{leftLabel}</span>
      </button>
    ) : <div />}
    <button
      onClick={rightOnClick}
      disabled={rightDisabled}
      title={rightDisabled ? "Fill in the direction first" : undefined}
      className="flex items-center"
      style={{
        height: 38,
        padding: "0 22px",
        gap: 8,
        borderRadius: 9999,
        background: rightDisabled ? COLORS.border : COLORS.textPrimary,
        border: "none",
        fontFamily: "'Geist Sans', sans-serif",
        fontSize: 13,
        fontWeight: 600,
        color: rightDisabled ? COLORS.textMuted : COLORS.surfacePanel,
        cursor: rightDisabled ? "not-allowed" : "pointer",
      }}
    >
      <span>{rightLabel}</span>
      {rightIcon === "arrow" && <IconArrowRight />}
    </button>
  </div>
);

// ===== Step 1: Direction =====

const StepDirection: FC = () => {
  const direction = useAgentStore((s) => s.discussion.direction);
  const requirements = useAgentStore((s) => s.discussion.requirements);
  const setDirection = useAgentStore((s) => s.setDiscussionDirection);
  const setRequirements = useAgentStore((s) => s.setDiscussionRequirements);
  const directionRef = useRef<HTMLTextAreaElement>(null);

  useEffect(() => {
    const t = setTimeout(() => directionRef.current?.focus(), 320);
    return () => clearTimeout(t);
  }, []);

  return (
    <div
      className="flex-1 min-h-0 overflow-y-auto"
      style={{ padding: "8px 24px 24px", background: COLORS.surfacePanel }}
    >
      <div className="flex flex-col" style={{ gap: 20 }}>
        {/* Intro block */}
        <div
          className="flex items-center"
          style={{
            gap: 12,
            padding: "14px 16px",
            borderRadius: 14,
            background: COLORS.surfaceInputBg,
            border: `1px solid ${COLORS.border}`,
          }}
        >
          <div
            className="shrink-0 flex items-center justify-center"
            style={{ width: 40, height: 40, borderRadius: 9999, background: COLORS.accent }}
          >
            <span style={{
              fontFamily: "'Geist Sans', sans-serif",
              fontSize: 12, fontWeight: 700, color: "#FFFFFF",
            }}>CC</span>
          </div>
          <div className="flex flex-col flex-1 min-w-0" style={{ gap: 2 }}>
            <span style={{
              fontFamily: "'Geist Sans', sans-serif",
              fontSize: 13, fontWeight: 600, color: COLORS.textPrimary,
            }}>
              Claude Code wants context
            </span>
            <span style={{
              fontFamily: "'Geist Sans', sans-serif",
              fontSize: 12, fontWeight: 400, color: COLORS.textMuted,
            }}>
              Set the direction before others join in.
            </span>
          </div>
        </div>

        {/* Direction textarea */}
        <div className="flex flex-col" style={{ gap: 6 }}>
          <label style={{
            fontFamily: "'Geist Sans', sans-serif",
            fontSize: 13, fontWeight: 600, color: COLORS.textPrimary,
          }}>
            What's this discussion about?
          </label>
          <span style={{
            fontFamily: "'Geist Sans', sans-serif",
            fontSize: 11, fontWeight: 400, color: COLORS.textMuted,
          }}>
            Required · 1–2 sentences
          </span>
          <textarea
            ref={directionRef}
            value={direction}
            onChange={(e) => setDirection(e.target.value)}
            rows={3}
            placeholder="e.g. Decide whether to migrate auth middleware to JWT or keep sessions. Need recommendation by Friday."
            className="resize-none outline-none"
            style={{
              marginTop: 4,
              padding: "14px 16px",
              borderRadius: 12,
              background: COLORS.surfaceCardBg,
              border: `1px solid ${COLORS.border}`,
              fontFamily: "'Geist Sans', sans-serif",
              fontSize: 13,
              lineHeight: 1.6,
              color: COLORS.textPrimary,
              width: "100%",
            }}
          />
        </div>

        {/* Requirements textarea */}
        <div className="flex flex-col" style={{ gap: 6 }}>
          <label style={{
            fontFamily: "'Geist Sans', sans-serif",
            fontSize: 13, fontWeight: 600, color: COLORS.textPrimary,
          }}>
            Requirements or constraints
          </label>
          <span style={{
            fontFamily: "'Geist Sans', sans-serif",
            fontSize: 11, fontWeight: 400, color: COLORS.textMuted,
          }}>
            Optional · hard limits, deadlines, out-of-scope items
          </span>
          <textarea
            value={requirements}
            onChange={(e) => setRequirements(e.target.value)}
            rows={4}
            placeholder="No breaking changes to the public API. Must stay backwards-compatible with v1 clients for at least 90 days."
            className="resize-none outline-none"
            style={{
              marginTop: 4,
              padding: "14px 16px",
              borderRadius: 12,
              background: COLORS.surfaceCardBg,
              border: `1px solid ${COLORS.border}`,
              fontFamily: "'Geist Sans', sans-serif",
              fontSize: 13,
              lineHeight: 1.6,
              color: COLORS.textPrimary,
              width: "100%",
            }}
          />
        </div>
      </div>
    </div>
  );
};

// ===== Step 2: Rules =====

const TURN_ORDER_OPTS: { id: TurnOrder; label: string; sub: string }[] = [
  { id: "primary_moderates", label: "Primary moderates", sub: "Claude Code calls on each agent" },
  { id: "round_robin",       label: "Round-robin",       sub: "Fixed rotating order" },
  { id: "free_form",         label: "Free-form",         sub: "Anyone speaks any time" },
];

const StepRules: FC = () => {
  const rules = useAgentStore((s) => s.discussion.rules);
  const setRules = useAgentStore((s) => s.setDiscussionRules);

  return (
    <div
      className="flex-1 min-h-0 overflow-y-auto"
      style={{ padding: "8px 24px 24px", background: COLORS.surfacePanel }}
    >
      <div className="flex flex-col" style={{ gap: 14 }}>
        {/* Rule 1 — expanded turn order radio */}
        <div
          className="flex flex-col"
          style={{
            padding: "16px 18px",
            gap: 14,
            borderRadius: 14,
            background: COLORS.surfaceCardBg,
            border: `1px solid ${COLORS.border}`,
          }}
        >
          <label style={{
            fontFamily: "'Geist Sans', sans-serif",
            fontSize: 13, fontWeight: 600, color: COLORS.textPrimary,
          }}>Turn order</label>
          <div className="flex flex-col" style={{ gap: 10 }}>
            {TURN_ORDER_OPTS.map((opt) => {
              const selected = rules.turnOrder === opt.id;
              return (
                <button
                  key={opt.id}
                  onClick={() => setRules({ turnOrder: opt.id })}
                  className="flex items-center"
                  style={{
                    gap: 10,
                    background: "transparent",
                    border: "none",
                    padding: 0,
                    textAlign: "left",
                    cursor: "pointer",
                  }}
                >
                  <div
                    className="shrink-0 flex items-center justify-center"
                    style={{
                      width: 16, height: 16, borderRadius: 9999,
                      background: selected ? COLORS.textPrimary : COLORS.surfaceCardBg,
                      border: selected ? "none" : `1.5px solid ${COLORS.borderHover}`,
                    }}
                  >
                    {selected && <div style={{ width: 6, height: 6, borderRadius: 9999, background: COLORS.surfacePanel }} />}
                  </div>
                  <span style={{
                    fontFamily: "'Geist Sans', sans-serif",
                    fontSize: 12, fontWeight: 500,
                    color: selected ? COLORS.textPrimary : COLORS.textBody,
                  }}>
                    {opt.label}  ·  {opt.sub}
                  </span>
                </button>
              );
            })}
          </div>
        </div>

        {/* Rule 2 — Max rounds preset + custom input */}
        <MaxRoundsRule current={rules.maxRounds} onChange={(v) => setRules({ maxRounds: v })} />
        {/* Rule 3 — Turn timeout preset + custom input (store in seconds, UI in minutes) */}
        <TurnTimeoutRule current={rules.turnTimeoutSec} onChange={(v) => setRules({ turnTimeoutSec: v })} />
        {/* Rule 4 — Auto-end toggle */}
        <div
          className="flex items-center"
          style={{
            justifyContent: "space-between",
            padding: "14px 18px",
            borderRadius: 14,
            background: COLORS.surfaceCardBg,
            border: `1px solid ${COLORS.border}`,
          }}
        >
          <div className="flex flex-col" style={{ gap: 2 }}>
            <span style={{
              fontFamily: "'Geist Sans', sans-serif",
              fontSize: 13, fontWeight: 600, color: COLORS.textPrimary,
            }}>Auto-end on consensus</span>
            <span style={{
              fontFamily: "'Geist Sans', sans-serif",
              fontSize: 11, fontWeight: 400, color: COLORS.textMuted,
            }}>Primary decides when it's done</span>
          </div>
          <button
            onClick={() => setRules({ autoEndOnConsensus: !rules.autoEndOnConsensus })}
            className="flex items-center"
            style={{
              width: 38, height: 22, borderRadius: 9999, padding: "0 3px",
              background: rules.autoEndOnConsensus ? COLORS.accent : "#D4CFC9",
              justifyContent: rules.autoEndOnConsensus ? "flex-end" : "flex-start",
              border: "none",
              cursor: "pointer",
            }}
            aria-label="Toggle auto-end"
          >
            <div style={{ width: 16, height: 16, borderRadius: 9999, background: "#FFFFFF" }} />
          </button>
        </div>
        {/* Rule 5 — Message style chip */}
        <ChipRow
          label="Message style"
          value={rules.messageStyle === "concise" ? "Concise · ≤200 chars" : "Deep dive · unlimited"}
          onClick={() => setRules({
            messageStyle: (rules.messageStyle === "concise" ? "deep_dive" : "concise") as MessageStyle,
          })}
        />
      </div>
    </div>
  );
};

// ===== Preset chip (used by MaxRoundsRule + TurnTimeoutRule) =====

const PresetChip: FC<{ label: string; active: boolean; onClick: () => void }> = ({ label, active, onClick }) => (
  <button
    onClick={onClick}
    className="flex items-center justify-center"
    style={{
      padding: "7px 14px",
      borderRadius: 9999,
      background: active ? COLORS.textPrimary : COLORS.surfaceInputBg,
      color: active ? COLORS.surfacePanel : COLORS.textBody,
      border: `1px solid ${active ? COLORS.textPrimary : COLORS.border}`,
      cursor: "pointer",
      fontFamily: "'Geist Sans', sans-serif",
      fontSize: 12,
      fontWeight: 600,
    }}
  >
    {label}
  </button>
);

// ===== Max rounds rule — 3 presets + Unlimited + custom input =====

const MAX_ROUNDS_PRESETS = [4, 8, 16];
const MAX_ROUNDS_MIN = 1;
const MAX_ROUNDS_MAX = 200;

const MaxRoundsRule: FC<{ current: number; onChange: (v: number) => void }> = ({ current, onChange }) => {
  const isUnlimited = current === 0;
  const [draft, setDraft] = useState(isUnlimited ? "" : String(current));

  // Keep the custom-input draft in sync when state changes via preset click
  useEffect(() => {
    setDraft(isUnlimited ? "" : String(current));
  }, [current, isUnlimited]);

  return (
    <div
      className="flex flex-col"
      style={{
        padding: "16px 18px",
        gap: 12,
        borderRadius: 14,
        background: COLORS.surfaceCardBg,
        border: `1px solid ${COLORS.border}`,
      }}
    >
      <div className="flex flex-col" style={{ gap: 2 }}>
        <label style={{
          fontFamily: "'Geist Sans', sans-serif",
          fontSize: 13, fontWeight: 600, color: COLORS.textPrimary,
        }}>
          Max rounds
        </label>
        <span style={{
          fontFamily: "'Geist Sans', sans-serif",
          fontSize: 11, fontWeight: 400, color: COLORS.textMuted,
        }}>
          Hard cap on how many turns before the discussion auto-ends
        </span>
      </div>
      <div className="flex flex-wrap" style={{ gap: 6 }}>
        {MAX_ROUNDS_PRESETS.map((v) => (
          <PresetChip key={v} label={String(v)} active={current === v} onClick={() => onChange(v)} />
        ))}
        <PresetChip label="Unlimited" active={isUnlimited} onClick={() => onChange(0)} />
      </div>
      <div className="flex items-center" style={{ gap: 8 }}>
        <span style={{
          fontFamily: "'Geist Sans', sans-serif",
          fontSize: 11, fontWeight: 500, color: COLORS.textMuted,
        }}>
          Custom:
        </span>
        <input
          type="number"
          min={MAX_ROUNDS_MIN}
          max={MAX_ROUNDS_MAX}
          value={draft}
          disabled={isUnlimited}
          placeholder={isUnlimited ? "—" : ""}
          onChange={(e) => {
            setDraft(e.target.value);
            const n = parseInt(e.target.value, 10);
            if (!isNaN(n) && n >= MAX_ROUNDS_MIN && n <= MAX_ROUNDS_MAX) {
              onChange(n);
            }
          }}
          className="outline-none"
          style={{
            width: 72,
            padding: "6px 10px",
            borderRadius: 8,
            background: isUnlimited ? COLORS.surfaceInputBg : COLORS.surfacePanel,
            border: `1px solid ${COLORS.border}`,
            fontFamily: "'Geist Sans', sans-serif",
            fontSize: 12,
            fontWeight: 600,
            color: isUnlimited ? COLORS.textMuted : COLORS.textPrimary,
          }}
        />
        <span style={{
          fontFamily: "'Geist Sans', sans-serif",
          fontSize: 11, fontWeight: 500, color: COLORS.textMuted,
        }}>
          rounds
        </span>
      </div>
    </div>
  );
};

// ===== Turn timeout rule — 3 presets + No limit + custom input (minutes) =====
// Store unit is seconds; UI unit is minutes.

const TURN_TIMEOUT_PRESETS_MIN = [2, 5, 15];
const TURN_TIMEOUT_MIN = 1;   // 1 minute floor
const TURN_TIMEOUT_MAX = 180; // 3 hours ceiling

const TurnTimeoutRule: FC<{ current: number; onChange: (v: number) => void }> = ({ current, onChange }) => {
  const isUnlimited = current === 0;
  const minutes = isUnlimited ? 0 : Math.max(1, Math.round(current / 60));
  const [draft, setDraft] = useState(isUnlimited ? "" : String(minutes));

  useEffect(() => {
    setDraft(isUnlimited ? "" : String(minutes));
  }, [minutes, isUnlimited]);

  return (
    <div
      className="flex flex-col"
      style={{
        padding: "16px 18px",
        gap: 12,
        borderRadius: 14,
        background: COLORS.surfaceCardBg,
        border: `1px solid ${COLORS.border}`,
      }}
    >
      <div className="flex flex-col" style={{ gap: 2 }}>
        <label style={{
          fontFamily: "'Geist Sans', sans-serif",
          fontSize: 13, fontWeight: 600, color: COLORS.textPrimary,
        }}>
          Turn timeout
        </label>
        <span style={{
          fontFamily: "'Geist Sans', sans-serif",
          fontSize: 11, fontWeight: 400, color: COLORS.textMuted,
        }}>
          How long each agent has to think before primary skips them
        </span>
      </div>
      <div className="flex flex-wrap" style={{ gap: 6 }}>
        {TURN_TIMEOUT_PRESETS_MIN.map((m) => (
          <PresetChip
            key={m}
            label={`${m} min`}
            active={!isUnlimited && minutes === m}
            onClick={() => onChange(m * 60)}
          />
        ))}
        <PresetChip label="No limit" active={isUnlimited} onClick={() => onChange(0)} />
      </div>
      <div className="flex items-center" style={{ gap: 8 }}>
        <span style={{
          fontFamily: "'Geist Sans', sans-serif",
          fontSize: 11, fontWeight: 500, color: COLORS.textMuted,
        }}>
          Custom:
        </span>
        <input
          type="number"
          min={TURN_TIMEOUT_MIN}
          max={TURN_TIMEOUT_MAX}
          value={draft}
          disabled={isUnlimited}
          placeholder={isUnlimited ? "—" : ""}
          onChange={(e) => {
            setDraft(e.target.value);
            const n = parseInt(e.target.value, 10);
            if (!isNaN(n) && n >= TURN_TIMEOUT_MIN && n <= TURN_TIMEOUT_MAX) {
              onChange(n * 60);
            }
          }}
          className="outline-none"
          style={{
            width: 72,
            padding: "6px 10px",
            borderRadius: 8,
            background: isUnlimited ? COLORS.surfaceInputBg : COLORS.surfacePanel,
            border: `1px solid ${COLORS.border}`,
            fontFamily: "'Geist Sans', sans-serif",
            fontSize: 12,
            fontWeight: 600,
            color: isUnlimited ? COLORS.textMuted : COLORS.textPrimary,
          }}
        />
        <span style={{
          fontFamily: "'Geist Sans', sans-serif",
          fontSize: 11, fontWeight: 500, color: COLORS.textMuted,
        }}>
          minutes
        </span>
      </div>
    </div>
  );
};

const ChipRow: FC<{ label: string; value: string; onClick: () => void }> = ({ label, value, onClick }) => (
  <button
    onClick={onClick}
    className="flex items-center"
    style={{
      justifyContent: "space-between",
      padding: "14px 18px",
      borderRadius: 14,
      background: COLORS.surfaceCardBg,
      border: `1px solid ${COLORS.border}`,
      cursor: "pointer",
      textAlign: "left",
    }}
  >
    <span style={{
      fontFamily: "'Geist Sans', sans-serif",
      fontSize: 13, fontWeight: 600, color: COLORS.textPrimary,
    }}>{label}</span>
    <span className="flex items-center" style={{ gap: 6 }}>
      <span style={{
        fontFamily: "'Geist Sans', sans-serif",
        fontSize: 12, fontWeight: 600, color: COLORS.textPrimary,
      }}>{value}</span>
      <svg width={12} height={12} viewBox="0 0 24 24" fill="none" stroke={COLORS.textMuted} strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round">
        <path d="m6 9 6 6 6-6"/>
      </svg>
    </span>
  </button>
);

// ===== Step 3: Participants =====

const StepParticipants: FC = () => {
  const instances = useAgentStore((s) => s.instances);
  const selected = useAgentStore((s) => s.discussion.participantIds);
  const toggle = useAgentStore((s) => s.toggleDiscussionParticipant);

  const rows = useMemo(() => {
    const arr: AgentInstanceInfo[] = [];
    // Primary first, then rest in insertion order
    const primary = Array.from(instances.values()).find((i) => i.is_primary_framework);
    if (primary) arr.push(primary);
    instances.forEach((info) => {
      if (!primary || info.instance_id !== primary.instance_id) arr.push(info);
    });
    return arr;
  }, [instances]);

  const participating = rows.filter((r) => selected.has(r.instance_id)).length;

  return (
    <div
      className="flex-1 min-h-0 overflow-y-auto"
      style={{ padding: "8px 24px 24px", background: COLORS.surfacePanel }}
    >
      <div className="flex flex-col" style={{ gap: 10 }}>
        <span style={{
          fontFamily: "'Geist Sans', sans-serif",
          fontSize: 12, fontWeight: 400, color: COLORS.textMuted,
        }}>
          Who joins the discussion?
        </span>
        {rows.map((info) => {
          const isSelected = selected.has(info.instance_id);
          const isPrimary = info.is_primary_framework;
          return (
            <button
              key={info.instance_id}
              onClick={() => toggle(info.instance_id)}
              disabled={isPrimary}
              className="flex items-center"
              style={{
                gap: 12,
                padding: "14px 16px",
                borderRadius: 14,
                background: COLORS.surfaceCardBg,
                border: isPrimary
                  ? `2px solid ${COLORS.accent}`
                  : `1px solid ${COLORS.border}`,
                cursor: isPrimary ? "default" : "pointer",
                textAlign: "left",
              }}
            >
              <div
                className="shrink-0 flex items-center justify-center"
                style={{
                  width: 36, height: 36, borderRadius: 9999,
                  background: AVATAR_BY_ADAPTER[info.adapter_id] ?? COLORS.textMuted,
                }}
              >
                <span style={{
                  fontFamily: "'Geist Sans', sans-serif",
                  fontSize: 12, fontWeight: 700, color: "#FFFFFF",
                }}>
                  {initialsOf(info.adapter_name)}
                </span>
              </div>
              <div className="flex flex-col flex-1 min-w-0" style={{ gap: 2 }}>
                <span style={{
                  fontFamily: "'Geist Sans', sans-serif",
                  fontSize: 13, fontWeight: 600,
                  color: isSelected ? COLORS.textPrimary : COLORS.textBody,
                }}>
                  {info.adapter_name}
                </span>
                <span style={{
                  fontFamily: "'Geist Sans', sans-serif",
                  fontSize: 11, fontWeight: 400,
                  color: isPrimary ? COLORS.accent : COLORS.textMuted,
                }}>
                  {isPrimary ? "Primary  ·  required" : info.status}
                </span>
              </div>
              {isSelected ? (
                <div
                  className="shrink-0 flex items-center justify-center"
                  style={{ width: 20, height: 20, borderRadius: 9999, color: COLORS.accent }}
                >
                  <IconCheck size={18} />
                </div>
              ) : (
                <div
                  className="shrink-0"
                  style={{
                    width: 18, height: 18, borderRadius: 9999,
                    background: COLORS.surfaceCardBg,
                    border: `1.5px solid ${COLORS.borderHover}`,
                  }}
                />
              )}
            </button>
          );
        })}
        <div
          className="mt-2 text-center"
          style={{
            fontFamily: "'Geist Sans', sans-serif",
            fontSize: 11, fontWeight: 500, color: COLORS.textMuted,
          }}
        >
          {participating} of {rows.length} agents participating  ·  including you as observer
        </div>
      </div>
    </div>
  );
};

// ===== Step 4: Chatroom =====

const ChatroomHeader: FC<{
  title: string;
  round: number;
  maxRounds: number;
  turnOrder: TurnOrder;
  paused: boolean;
  onPauseToggle: () => void;
  onEnd: () => void;
}> = ({ title, round, maxRounds, turnOrder, paused, onPauseToggle, onEnd }) => {
  const orderLabel =
    turnOrder === "primary_moderates" ? "Primary moderates" :
    turnOrder === "round_robin"       ? "Round-robin"       : "Free-form";
  return (
    <div
      className="flex items-center shrink-0"
      style={{
        height: 64,
        padding: "0 16px 0 20px",
        gap: 10,
        background: COLORS.surfacePanel,
        borderBottom: `1px solid ${COLORS.border}`,
      }}
    >
      <div className="flex flex-col flex-1 min-w-0" style={{ gap: 2 }}>
        <h2 style={{
          fontFamily: "'Fraunces Variable', Georgia, serif",
          fontSize: 18, fontWeight: 700, color: COLORS.textPrimary,
          letterSpacing: -0.2, margin: 0, lineHeight: 1.1,
          whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis",
        }}>
          {title}
        </h2>
        <span style={{
          fontFamily: "'Geist Sans', sans-serif",
          fontSize: 11, fontWeight: 500, color: COLORS.textMuted,
          whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis",
        }}>
          Round {round} of {maxRounds}  ·  {paused ? "Paused" : orderLabel}
        </span>
      </div>
      <button
        onClick={onPauseToggle}
        className="shrink-0 flex items-center"
        style={{
          height: 32, padding: "0 12px", gap: 6,
          borderRadius: 9999,
          background: COLORS.warningBg,
          border: `1px solid ${COLORS.warning}`,
          color: COLORS.warningText,
          cursor: "pointer",
        }}
        title={paused ? "Resume discussion" : "Pause discussion"}
      >
        {paused ? <IconPlay /> : <IconPause />}
        <span style={{ fontFamily: "'Geist Sans', sans-serif", fontSize: 12, fontWeight: 600 }}>
          {paused ? "Resume" : "Pause"}
        </span>
      </button>
      <button
        onClick={onEnd}
        className="shrink-0 flex items-center"
        style={{
          height: 32, padding: "0 12px", gap: 6,
          borderRadius: 9999,
          background: COLORS.dangerBg,
          border: `1px solid ${COLORS.danger}`,
          color: COLORS.dangerText,
          cursor: "pointer",
        }}
        title="End discussion"
      >
        <IconStop />
        <span style={{ fontFamily: "'Geist Sans', sans-serif", fontSize: 12, fontWeight: 600 }}>
          End
        </span>
      </button>
    </div>
  );
};

const ChatroomBody: FC<{ messages: DiscussionMessage[] }> = ({ messages }) => {
  const endRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    endRef.current?.scrollIntoView({ behavior: "smooth", block: "end" });
  }, [messages.length]);

  return (
    <div
      className="flex-1 min-h-0 overflow-y-auto"
      style={{ padding: 20, background: COLORS.surfacePanel }}
    >
      <div className="flex flex-col" style={{ gap: 18 }}>
        {messages.map((msg) => {
          const isUser = msg.authorInstanceId === "user";
          const headerColor = isUser || msg.interject ? COLORS.accent : COLORS.textPrimary;
          const bodyColor = isUser ? COLORS.textPrimary : COLORS.textBody;
          return (
            <div key={msg.id} className="flex items-start" style={{ gap: 10 }}>
              <div
                className="shrink-0 flex items-center justify-center"
                style={{
                  width: 32, height: 32, borderRadius: 9999,
                  background: msg.avatarBg,
                }}
              >
                <span style={{
                  fontFamily: "'Geist Sans', sans-serif",
                  fontSize: isUser ? 12 : 11, fontWeight: 700, color: "#FFFFFF",
                }}>
                  {msg.initials}
                </span>
              </div>
              <div className="flex flex-col flex-1 min-w-0" style={{ gap: 4 }}>
                <span style={{
                  fontFamily: "'Geist Sans', sans-serif",
                  fontSize: 11, fontWeight: 600, color: headerColor,
                }}>
                  {msg.authorName}  ·  {msg.interject ? `Interjected during Round ${msg.round}` : `Round ${msg.round}`}  ·  {relativeTime(msg.time)}
                </span>
                <p style={{
                  fontFamily: "'Geist Sans', sans-serif",
                  fontSize: 13, lineHeight: 1.55,
                  color: bodyColor,
                  margin: 0, wordBreak: "break-word",
                }}>
                  {msg.body}
                </p>
              </div>
            </div>
          );
        })}
        <div ref={endRef} />
      </div>
    </div>
  );
};

function relativeTime(ts: number): string {
  const diff = Date.now() - ts;
  const sec = Math.max(0, Math.floor(diff / 1000));
  if (sec < 10) return "just now";
  if (sec < 60) return `${sec}s ago`;
  const min = Math.floor(sec / 60);
  if (min < 60) return `${min}m ago`;
  const hr = Math.floor(min / 60);
  return `${hr}h ago`;
}

const ChatroomFooter: FC<{
  paused: boolean;
  primaryName: string;
  onInterject: (text: string) => void;
}> = ({ paused, primaryName, onInterject }) => {
  const [draft, setDraft] = useState("");
  const inputRef = useRef<HTMLTextAreaElement>(null);

  useEffect(() => {
    const t = setTimeout(() => inputRef.current?.focus(), 320);
    return () => clearTimeout(t);
  }, []);

  const send = () => {
    const trimmed = draft.trim();
    if (!trimmed) return;
    onInterject(trimmed);
    setDraft("");
  };
  const onKey = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if ((e.ctrlKey || e.metaKey) && e.key === "Enter") {
      e.preventDefault();
      send();
    }
  };

  const placeholder = paused
    ? `Talk to ${primaryName} (paused)…`
    : `Interject to ${primaryName}…`;

  return (
    <div
      className="flex flex-col shrink-0"
      style={{
        padding: "8px 16px 10px",
        gap: 6,
        background: COLORS.surfacePanel,
        borderTop: `1px solid ${COLORS.border}`,
      }}
    >
      <span style={{
        fontFamily: "'Geist Sans', sans-serif",
        fontSize: 10, fontWeight: 500, color: COLORS.textMuted,
      }}>
        {paused ? "Agents are frozen — your message goes directly to the primary" : "Ctrl+Enter interjects without interrupting the current turn"}
      </span>
      <div className="flex items-center" style={{ gap: 10 }}>
        <div
          className="flex-1 min-w-0 flex items-center"
          style={{
            height: 40,
            padding: "0 14px",
            borderRadius: 12,
            background: COLORS.surfaceCardBg,
            border: `1px solid ${paused ? COLORS.warning : COLORS.border}`,
          }}
        >
          <textarea
            ref={inputRef}
            value={draft}
            onChange={(e) => setDraft(e.target.value)}
            onKeyDown={onKey}
            rows={1}
            placeholder={placeholder}
            className="flex-1 min-w-0 resize-none bg-transparent outline-none"
            style={{
              fontFamily: "'Geist Sans', sans-serif",
              fontSize: 13, lineHeight: 1.5, color: COLORS.textPrimary,
              border: "none", padding: 0,
            }}
          />
        </div>
        <button
          onClick={send}
          disabled={!draft.trim()}
          className="shrink-0 flex items-center justify-center"
          style={{
            width: 38, height: 38,
            borderRadius: 9999,
            background: COLORS.textPrimary,
            color: COLORS.surfacePanel,
            border: "none",
            opacity: draft.trim() ? 1 : 0.35,
            cursor: draft.trim() ? "pointer" : "not-allowed",
          }}
          title="Send (Ctrl+Enter)"
          aria-label="Send"
        >
          <IconArrowUp />
        </button>
      </div>
    </div>
  );
};

// ===== Main component =====

const DiscussionPanel: FC = () => {
  const open = useAgentStore((s) => s.discussion.open);
  const step = useAgentStore((s) => s.discussion.step);
  const direction = useAgentStore((s) => s.discussion.direction);
  const rules = useAgentStore((s) => s.discussion.rules);
  const participantIds = useAgentStore((s) => s.discussion.participantIds);
  const messages = useAgentStore((s) => s.discussion.messages);
  const currentRound = useAgentStore((s) => s.discussion.currentRound);
  const paused = useAgentStore((s) => s.discussion.paused);
  const instances = useAgentStore((s) => s.instances);
  const setStep = useAgentStore((s) => s.setDiscussionStep);
  const close = useAgentStore((s) => s.closeDiscussionWizard);
  const start = useAgentStore((s) => s.startDiscussion);
  const pauseAction = useAgentStore((s) => s.pauseDiscussion);
  const resume = useAgentStore((s) => s.resumeDiscussion);
  const endAction = useAgentStore((s) => s.endDiscussion);
  const interject = useAgentStore((s) => s.interjectDiscussion);

  const [showEndConfirm, setShowEndConfirm] = useState(false);

  // Capture-phase ESC handler so the wizard beats ExpandedAgentCard underneath.
  // On step 4 (chatroom), ESC surfaces the End confirmation instead of closing.
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== "Escape") return;
      e.stopImmediatePropagation();
      if (step === 4) {
        setShowEndConfirm(true);
      } else {
        close();
      }
    };
    window.addEventListener("keydown", onKey, true);
    return () => window.removeEventListener("keydown", onKey, true);
  }, [open, step, close]);

  const primaryInstance = useMemo(() => {
    for (const info of instances.values()) {
      if (info.is_primary_framework) return info;
    }
    return instances.values().next().value ?? null;
  }, [instances]);
  const primaryName = primaryInstance?.adapter_name ?? "Primary agent";

  const directionFilled = direction.trim().length > 0;
  const participantCount = participantIds.size;

  const handleNext = useCallback(() => {
    if (step === 1 && directionFilled) setStep(2);
    else if (step === 2) setStep(3);
    else if (step === 3 && participantCount >= 2) start();
  }, [step, directionFilled, participantCount, setStep, start]);

  const handleBack = useCallback(() => {
    if (step === 2) setStep(1);
    else if (step === 3) setStep(2);
  }, [step, setStep]);

  const confirmEnd = () => {
    setShowEndConfirm(false);
    endAction();
  };
  const cancelEnd = () => setShowEndConfirm(false);

  if (!open) return null;

  const titleByStep: Record<DiscussionStep, string> = {
    1: "New Discussion",
    2: "Discussion Rules",
    3: "Pick Participants",
    4: direction.trim() || "Discussion",
  };
  const stepLabelByStep: Record<DiscussionStep, string> = {
    1: "Direction",
    2: "Rules",
    3: "Participants",
    4: "Live",
  };

  return (
    <div
      className="fixed inset-y-0 right-0 z-45 flex"
      role="dialog"
      aria-modal="false"
      aria-label="Discussion wizard"
      style={{ pointerEvents: "none" }}
    >
      <div
        className="discussion-panel-enter flex flex-col shrink-0 overflow-hidden"
        style={{
          width: 480,
          height: "100%",
          background: COLORS.surfacePanel,
          borderLeft: `1px solid ${COLORS.border}`,
          boxShadow: "-16px 0 48px rgba(0,0,0,0.25), -4px 0 12px rgba(0,0,0,0.15)",
          pointerEvents: "auto",
          position: "relative",
        }}
      >
        {step === 4 ? (
          <>
            <ChatroomHeader
              title={titleByStep[4]}
              round={currentRound}
              maxRounds={rules.maxRounds}
              turnOrder={rules.turnOrder}
              paused={paused}
              onPauseToggle={paused ? resume : pauseAction}
              onEnd={() => setShowEndConfirm(true)}
            />
            <ChatroomBody messages={messages} />
            <ChatroomFooter
              paused={paused}
              primaryName={primaryName}
              onInterject={interject}
            />
          </>
        ) : (
          <>
            <Header
              title={titleByStep[step]}
              onBack={step > 1 ? handleBack : undefined}
              onClose={close}
            />
            <StepIndicator step={step} label={stepLabelByStep[step]} />
            {step === 1 && <StepDirection />}
            {step === 2 && <StepRules />}
            {step === 3 && <StepParticipants />}
            <Footer
              leftLabel={step === 1 ? "Cancel" : "Back"}
              leftOnClick={step === 1 ? close : handleBack}
              rightLabel={step === 3 ? "Start Discussion" : "Next"}
              rightDisabled={
                (step === 1 && !directionFilled) ||
                (step === 3 && participantCount < 2)
              }
              rightOnClick={handleNext}
            />
          </>
        )}

        {/* End confirmation overlay (chatroom only) */}
        {showEndConfirm && (
          <div
            className="absolute inset-0 z-50 flex items-center justify-center"
            style={{ background: "rgba(26,26,26,0.55)", backdropFilter: "blur(4px)" }}
          >
            <div
              className="flex flex-col"
              style={{
                width: 340,
                padding: 24,
                gap: 16,
                borderRadius: 16,
                background: COLORS.surfacePanel,
                border: `1px solid ${COLORS.border}`,
                boxShadow: "0 12px 32px rgba(0,0,0,0.35)",
              }}
            >
              <div className="flex flex-col" style={{ gap: 6 }}>
                <h3 style={{
                  fontFamily: "'Fraunces Variable', Georgia, serif",
                  fontSize: 18, fontWeight: 700,
                  color: COLORS.textPrimary, margin: 0,
                }}>
                  End this discussion?
                </h3>
                <p style={{
                  fontFamily: "'Geist Sans', sans-serif",
                  fontSize: 12, lineHeight: 1.5,
                  color: COLORS.textBody, margin: 0,
                }}>
                  All agents will stop speaking and the chatroom will close.
                  You can always start a new discussion from the top bar.
                </p>
              </div>
              <div className="flex items-center" style={{ gap: 10, justifyContent: "flex-end" }}>
                <button
                  onClick={cancelEnd}
                  style={{
                    height: 36, padding: "0 16px",
                    borderRadius: 9999,
                    background: COLORS.surfaceInputBg,
                    border: `1px solid ${COLORS.border}`,
                    fontFamily: "'Geist Sans', sans-serif",
                    fontSize: 13, fontWeight: 500, color: COLORS.textBody,
                    cursor: "pointer",
                  }}
                >
                  Keep going
                </button>
                <button
                  onClick={confirmEnd}
                  style={{
                    height: 36, padding: "0 18px",
                    borderRadius: 9999,
                    background: COLORS.danger,
                    border: "none",
                    fontFamily: "'Geist Sans', sans-serif",
                    fontSize: 13, fontWeight: 600, color: "#FFFFFF",
                    cursor: "pointer",
                  }}
                >
                  End discussion
                </button>
              </div>
            </div>
          </div>
        )}
      </div>
    </div>
  );
};

export { DiscussionPanel };
