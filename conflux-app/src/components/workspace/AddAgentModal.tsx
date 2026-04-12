// ===== AddAgentModal =====
// Centered glass modal for picking an adapter and spawning a new agent instance.
// Matches design/conflux.pen frame "AddAgent 弹窗" (FLo0j).

import { type FC, useCallback, useEffect, useState } from "react";
import { createAgentInstance, listAdapters } from "@/lib/tauri-bridge";
import { useAgentStore } from "@/stores/agentStore";
import { useWorkspaceStore } from "@/stores/workspaceStore";
import type { AdapterInfo, AdapterId, AgentInstanceInfo, CardLayout } from "@/types";

// ===== C2-A4b Card color presets =====

const CARD_COLOR_PRESETS = [
  { id: "ice-blue",  color: "#B8D4E3", name: "Ice Blue" },
  { id: "amber",     color: "#FFB800", name: "Amber" },
  { id: "mint",      color: "#5FD47F", name: "Mint" },
  { id: "rose",      color: "#FF6B6B", name: "Rose" },
  { id: "lavender",  color: "#C8B5E3", name: "Lavender" },
  { id: "peach",     color: "#E3C0A8", name: "Peach" },
  { id: "gold",      color: "#D4C88A", name: "Gold" },
  { id: "sky",       color: "#7FC8FF", name: "Sky" },
];

const DEFAULT_ADAPTER_COLORS: Record<string, string> = {
  "claude-code": "#B8D4E3",
  codex:         "#FFB800",
  aider:         "#8EA4B8",
  opencode:      "#C9B894",
};

// ===== Smart placement for new cards =====
//
// Walks a coarse grid looking for the first spot where a new card of the
// given size wouldn't overlap any existing card (with a small gap). Falls
// back to a cascading diagonal if every grid slot is taken (which only
// happens past ~100 cards — acceptable for the cascade fallback). This is
// intentionally simple (no bin-packing) because the backend auto-pack
// command handles the ideal layout; we only need to guarantee new cards
// don't land on top of existing ones.
const PLACEMENT_GAP = 24;
const PLACEMENT_STEP = 40;
const PLACEMENT_MAX_X = 3200;
const PLACEMENT_MAX_Y = 2400;

function rectsOverlap(
  ax: number, ay: number, aw: number, ah: number,
  bx: number, by: number, bw: number, bh: number,
  gap: number
): boolean {
  return !(
    ax + aw + gap <= bx ||
    bx + bw + gap <= ax ||
    ay + ah + gap <= by ||
    by + bh + gap <= ay
  );
}

function findFreeSpot(
  cards: CardLayout[],
  width: number,
  height: number
): { x: number; y: number } {
  // Start from (24, 24) so new cards align with the demo seed's top-left.
  for (let y = 24; y < PLACEMENT_MAX_Y; y += PLACEMENT_STEP) {
    for (let x = 24; x < PLACEMENT_MAX_X; x += PLACEMENT_STEP) {
      const collides = cards.some((c) =>
        rectsOverlap(
          x, y, width, height,
          c.position.x, c.position.y, c.size.width, c.size.height,
          PLACEMENT_GAP
        )
      );
      if (!collides) return { x, y };
    }
  }
  // Fallback — every grid slot is taken. Cascade past the last card.
  const n = cards.length;
  return { x: 24 + n * 30, y: 24 + n * 30 };
}

interface AddAgentModalProps {
  visible: boolean;
  onClose: () => void;
}

interface VendorMeta {
  vendor: string;
  caption: string;
  icon: (props: { size: number; color: string }) => JSX.Element;
}

const ICON_SPARKLES = ({ size, color }: { size: number; color: string }) => (
  <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke={color} strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
    <path d="m12 3-1.9 5.8a2 2 0 0 1-1.287 1.288L3 12l5.8 1.9a2 2 0 0 1 1.288 1.287L12 21l1.9-5.8a2 2 0 0 1 1.287-1.288L21 12l-5.8-1.9a2 2 0 0 1-1.288-1.287Z" />
    <path d="M5 3v4M3 5h4M19 17v4M17 19h4" />
  </svg>
);

const ICON_TERMINAL = ({ size, color }: { size: number; color: string }) => (
  <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke={color} strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
    <path d="m7 11 2-2-2-2" /><path d="M11 13h4" /><rect width="18" height="18" x="3" y="3" rx="2" ry="2" />
  </svg>
);

const ICON_GIT_BRANCH = ({ size, color }: { size: number; color: string }) => (
  <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke={color} strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
    <line x1="6" x2="6" y1="3" y2="15" /><circle cx="18" cy="6" r="3" /><circle cx="6" cy="18" r="3" />
    <path d="M18 9a9 9 0 0 1-9 9" />
  </svg>
);

const ICON_SQUARE_CODE = ({ size, color }: { size: number; color: string }) => (
  <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke={color} strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
    <rect width="18" height="18" x="3" y="3" rx="2" /><path d="m10 10-2 2 2 2" /><path d="m14 14 2-2-2-2" />
  </svg>
);

const ICON_BOX = ({ size, color }: { size: number; color: string }) => (
  <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke={color} strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
    <path d="M21 8a2 2 0 0 0-1-1.73l-7-4a2 2 0 0 0-2 0l-7 4A2 2 0 0 0 3 8v8a2 2 0 0 0 1 1.73l7 4a2 2 0 0 0 2 0l7-4A2 2 0 0 0 21 16Z" />
    <path d="m3.3 7 8.7 5 8.7-5" /><path d="M12 22V12" />
  </svg>
);

const ICON_FOLDER = ({ size, color }: { size: number; color: string }) => (
  <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke={color} strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
    <path d="M20 20a2 2 0 0 0 2-2V8a2 2 0 0 0-2-2h-7.9a2 2 0 0 1-1.69-.9L9.6 3.9A2 2 0 0 0 7.93 3H4a2 2 0 0 0-2 2v13a2 2 0 0 0 2 2Z" />
  </svg>
);

const ICON_HOME = ({ size, color }: { size: number; color: string }) => (
  <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke={color} strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
    <path d="M15 21v-8a1 1 0 0 0-1-1h-4a1 1 0 0 0-1 1v8" />
    <path d="M3 10a2 2 0 0 1 .709-1.528l7-5.999a2 2 0 0 1 2.582 0l7 5.999A2 2 0 0 1 21 10v9a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z" />
  </svg>
);

const ICON_X = ({ size, color }: { size: number; color: string }) => (
  <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke={color} strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
    <path d="M18 6 6 18M6 6l12 12" />
  </svg>
);

const ICON_ARROW_RIGHT = ({ size, color }: { size: number; color: string }) => (
  <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke={color} strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
    <path d="M5 12h14M12 5l7 7-7 7" />
  </svg>
);

const VENDOR_META: Record<string, VendorMeta> = {
  "claude-code": { vendor: "anthropic", caption: "anthropic · flagship agent framework", icon: ICON_SPARKLES },
  codex: { vendor: "openai", caption: "openai · code-focused reasoning", icon: ICON_TERMINAL },
  aider: { vendor: "paul-gauthier", caption: "paul-gauthier · git-aware pair programmer", icon: ICON_GIT_BRANCH },
  opencode: { vendor: "opencode", caption: "opencode · PR review & codebase triage", icon: ICON_SQUARE_CODE },
};

function metaFor(adapterId: string): VendorMeta {
  return VENDOR_META[adapterId] ?? {
    vendor: adapterId,
    caption: `${adapterId} · custom adapter`,
    icon: ICON_BOX,
  };
}

// Unwrap a ConfluxError that arrives from Tauri as a serialized enum object.
// Shape: { PtyError: { message: "..." } }, { AdapterNotFound: { adapter_id } }, ...
// Returns a human-readable string that prefixes the variant name so the user
// can tell a PTY failure apart from a config or permission failure.
function formatBackendError(err: unknown): string {
  if (err instanceof Error) return err.message;
  if (typeof err === "string") return err;
  if (err && typeof err === "object") {
    const entries = Object.entries(err as Record<string, unknown>);
    if (entries.length === 1) {
      const [variant, payload] = entries[0];
      if (payload && typeof payload === "object") {
        const p = payload as Record<string, unknown>;
        const msg =
          (typeof p.message === "string" && p.message) ||
          (typeof p.instance_id === "string" && `instance_id=${p.instance_id}`) ||
          (typeof p.adapter_id === "string" && `adapter_id=${p.adapter_id}`) ||
          JSON.stringify(payload);
        return `${variant}: ${msg}`;
      }
      return `${variant}`;
    }
    try {
      return JSON.stringify(err);
    } catch {
      return String(err);
    }
  }
  return String(err);
}

// Best-effort default working dir.
// Windows: HOMEDRIVE + HOMEPATH → e.g. "C:\Users\zwm"
// Fallback: empty string (backend fallback to process cwd)
function guessDefaultWorkingDir(): string {
  const remembered = localStorage.getItem("conflux.lastWorkingDir");
  if (remembered && remembered.trim().length > 0) return remembered;
  // Browsers don't expose process env; leave empty so backend uses cwd
  return "";
}

const AddAgentModal: FC<AddAgentModalProps> = ({ visible, onClose }) => {
  const addInstance = useAgentStore((s) => s.addInstance);
  const addCard = useWorkspaceStore((s) => s.addCard);

  const [adapters, setAdapters] = useState<AdapterInfo[]>([]);
  const [selectedId, setSelectedId] = useState<AdapterId | null>(null);
  const [workingDir, setWorkingDir] = useState<string>("");
  const [cardColor, setCardColor] = useState<string>(CARD_COLOR_PRESETS[0].color);
  const setCardColorStore = useAgentStore((s) => s.setCardColor);
  const [loading, setLoading] = useState(false);
  const [creating, setCreating] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Restore last-used working dir + auto-assign adapter default color
  useEffect(() => {
    if (!visible) return;
    setWorkingDir(guessDefaultWorkingDir());
  }, [visible]);

  // When adapter selection changes, auto-set color to adapter default
  useEffect(() => {
    if (selectedId) {
      setCardColor(DEFAULT_ADAPTER_COLORS[selectedId] ?? CARD_COLOR_PRESETS[0].color);
    }
  }, [selectedId]);

  // Load adapters when modal opens
  useEffect(() => {
    if (!visible) return;
    setLoading(true);
    setError(null);
    listAdapters()
      .then((list) => {
        setAdapters(list);
        if (list.length > 0 && selectedId === null) {
          setSelectedId(list[0].id);
        }
      })
      .catch(() => {
        // Backend unavailable — show built-in demo list so user still sees the modal.
        const demo: AdapterInfo[] = [
          { id: "claude-code", name: "Claude Code", command: "claude", capabilities: { can_coordinate: true, coordination_template: null, can_parse_tree: true, can_detect_permission: true }, is_builtin: true },
          { id: "codex", name: "Codex", command: "codex", capabilities: { can_coordinate: false, coordination_template: null, can_parse_tree: false, can_detect_permission: false }, is_builtin: true },
          { id: "aider", name: "Aider", command: "aider", capabilities: { can_coordinate: false, coordination_template: null, can_parse_tree: false, can_detect_permission: false }, is_builtin: true },
          { id: "opencode", name: "OpenCode", command: "opencode", capabilities: { can_coordinate: false, coordination_template: null, can_parse_tree: false, can_detect_permission: false }, is_builtin: true },
        ];
        setAdapters(demo);
        setSelectedId(demo[0].id);
        setError("Backend unavailable — showing built-in adapter list (preview only).");
      })
      .finally(() => setLoading(false));
  }, [visible, selectedId]);

  // Escape key to close
  useEffect(() => {
    if (!visible) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [visible, onClose]);

  const handleCreate = useCallback(async () => {
    if (!selectedId || creating) return;
    setCreating(true);
    setError(null);
    try {
      // Pass workingDir iff user provided one; empty string → undefined so
      // backend falls back to std::env::current_dir().
      const trimmedDir = workingDir.trim();
      const dirArg = trimmedDir.length > 0 ? trimmedDir : undefined;
      const instance: AgentInstanceInfo = await createAgentInstance(
        selectedId,
        dirArg,
        undefined,
      );
      addInstance(instance);
      // Save user-picked card color
      setCardColorStore(instance.instance_id, cardColor);
      // Size must be >= MIN_CARD_W/H (580x380) enforced by AgentCard.
      // Using a slightly larger default (620x420) so the card has breathing
      // room for the header/footer chrome and a few terminal rows.
      const width = 620;
      const height = 420;
      // Place the card on the first empty grid slot so it doesn't land on
      // top of existing demo cards / previous real instances.
      const existingCards = useWorkspaceStore.getState().cards;
      const position = findFreeSpot(existingCards, width, height);
      addCard({
        instance_id: instance.instance_id,
        position,
        size: { width, height },
        z_index: existingCards.length + 1,
      });
      // Remember for next time (only on success)
      if (dirArg) localStorage.setItem("conflux.lastWorkingDir", dirArg);
      onClose();
      setSelectedId(null);
    } catch (err) {
      // Backend returns ConfluxError as a serialized enum object, e.g.
      //   { "PtyError": { "message": "program not found: claude" } }
      // not a standard Error instance. Unwrap the variant so the user sees
      // the actual stderr instead of a useless "Check backend" fallback.
      setError(formatBackendError(err));
      // Also log the raw object to DevTools for deeper inspection.
      console.error("[AddAgent] create_agent_instance failed:", err);
    } finally {
      setCreating(false);
    }
  }, [selectedId, creating, workingDir, addInstance, addCard, onClose]);

  if (!visible) return null;

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center"
      role="dialog"
      aria-modal="true"
      aria-label="New Agent"
    >
      {/* Backdrop */}
      <div
        className="absolute inset-0"
        style={{ background: "rgba(0,0,0,0.53)", backdropFilter: "blur(6px)", WebkitBackdropFilter: "blur(6px)" }}
        onClick={onClose}
        aria-hidden="true"
      />

      {/* Modal card */}
      <div
        className="relative flex flex-col overflow-hidden"
        style={{
          width: 440,
          maxHeight: "90vh",
          background: "rgba(255,255,255,0.04)",
          backdropFilter: "blur(24px)",
          WebkitBackdropFilter: "blur(24px)",
          border: "1px solid rgba(255,255,255,0.13)",
          borderRadius: 12,
          boxShadow: "0 16px 48px rgba(0,0,0,0.4), 0 0 0 1px rgba(255,255,255,0.04) inset",
        }}
      >
        {/* Header */}
        <div className="flex items-start shrink-0" style={{ padding: "28px 32px 22px 32px", gap: 16 }}>
          <div className="flex-1 min-w-0 flex flex-col" style={{ gap: 6 }}>
            <h2
              style={{
                fontFamily: "'Fraunces Variable', Georgia, serif",
                fontSize: 26,
                fontWeight: 600,
                color: "#F2F2F2",
                letterSpacing: -0.2,
                lineHeight: 1.15,
                margin: 0,
              }}
            >
              New Agent
            </h2>
            <p
              style={{
                fontFamily: "'Geist Sans', sans-serif",
                fontSize: 13,
                color: "#6B7280",
                margin: 0,
              }}
            >
              Pick an adapter to spawn a new session
            </p>
          </div>
          <button
            onClick={onClose}
            className="shrink-0 flex items-center justify-center transition-colors"
            style={{
              width: 32,
              height: 32,
              background: "rgba(255,255,255,0.07)",
              border: "1px solid rgba(255,255,255,0.08)",
              borderRadius: 8,
              color: "#6B7280",
            }}
            aria-label="Close"
          >
            <ICON_X size={16} color="currentColor" />
          </button>
        </div>

        {/* Divider */}
        <div style={{ height: 1, background: "rgba(255,255,255,0.082)" }} />

        {/* Body */}
        <div className="flex-1 overflow-y-auto flex flex-col" style={{ padding: "22px 24px", gap: 14 }}>
          <span
            style={{
              fontFamily: "'Geist Sans', sans-serif",
              fontSize: 10,
              fontWeight: 600,
              letterSpacing: 1.5,
              color: "#6B7280",
              textTransform: "uppercase",
            }}
          >
            Available Adapters
          </span>

          <div className="flex flex-col" style={{ gap: 8 }}>
            {loading ? (
              <div style={{ padding: "24px", textAlign: "center", color: "#6B7280", fontFamily: "'Geist Sans',sans-serif", fontSize: 12 }}>
                Loading adapters...
              </div>
            ) : adapters.length === 0 ? (
              <div style={{ padding: "24px", textAlign: "center", color: "#6B7280", fontFamily: "'Geist Sans',sans-serif", fontSize: 12 }}>
                No adapters registered.
              </div>
            ) : (
              adapters.map((adapter) => {
                const isSelected = selectedId === adapter.id;
                const meta = metaFor(adapter.id);
                const IconComp = meta.icon;
                return (
                  <button
                    key={adapter.id}
                    onClick={() => setSelectedId(adapter.id)}
                    className="flex items-center w-full text-left transition-colors"
                    style={{
                      padding: "14px 16px",
                      gap: 14,
                      borderRadius: 8,
                      background: isSelected ? "rgba(255,255,255,0.07)" : "rgba(255,255,255,0.04)",
                      border: isSelected ? "1px solid #B8D4E3" : "1px solid rgba(255,255,255,0.082)",
                    }}
                  >
                    {/* Icon bg */}
                    <div
                      className="shrink-0 flex items-center justify-center"
                      style={{
                        width: 36,
                        height: 36,
                        borderRadius: 8,
                        background: isSelected ? "rgba(184,212,227,0.15)" : "rgba(255,255,255,0.055)",
                      }}
                    >
                      <IconComp size={18} color={isSelected ? "#B8D4E3" : "#B8B3B0"} />
                    </div>

                    {/* Name + caption */}
                    <div className="flex-1 min-w-0 flex flex-col" style={{ gap: 3 }}>
                      <span
                        className="truncate"
                        style={{
                          fontFamily: "'Geist Sans',sans-serif",
                          fontSize: 14,
                          fontWeight: 600,
                          color: "#F2F2F2",
                        }}
                      >
                        {adapter.name}
                      </span>
                      <span
                        className="truncate"
                        style={{
                          fontFamily: "'Geist Sans',sans-serif",
                          fontSize: 11,
                          color: "#6B7280",
                        }}
                      >
                        {meta.caption}
                      </span>
                    </div>
                  </button>
                );
              })
            )}
          </div>

          {/* Working Directory section */}
          <div className="flex flex-col" style={{ gap: 10, marginTop: 6 }}>
            <div className="flex items-center" style={{ gap: 8 }}>
              <ICON_FOLDER size={12} color="#6B7280" />
              <span
                style={{
                  fontFamily: "'Geist Sans', sans-serif",
                  fontSize: 10,
                  fontWeight: 600,
                  letterSpacing: 1.5,
                  color: "#6B7280",
                  textTransform: "uppercase",
                }}
              >
                Working Directory
              </span>
            </div>
            <div className="flex items-center" style={{ gap: 8 }}>
              <input
                type="text"
                value={workingDir}
                onChange={(e) => setWorkingDir(e.target.value)}
                placeholder="e.g. D:\Projects\my-app  (leave blank for default)"
                className="flex-1 min-w-0 outline-none"
                style={{
                  padding: "10px 14px",
                  borderRadius: 8,
                  background: "rgba(255,255,255,0.04)",
                  border: "1px solid rgba(255,255,255,0.082)",
                  fontFamily: "'Geist Sans', sans-serif",
                  fontSize: 12,
                  color: "#F2F2F2",
                }}
              />
              <button
                onClick={() => {
                  // Fallback to user home dir guess for Windows
                  setWorkingDir("C:\\Users\\");
                }}
                className="shrink-0 flex items-center justify-center transition-colors"
                style={{
                  width: 36,
                  height: 36,
                  background: "rgba(255,255,255,0.055)",
                  border: "1px solid rgba(255,255,255,0.082)",
                  borderRadius: 8,
                  color: "#B8B3B0",
                }}
                title="Fill with C:\\Users\\ as a starting point"
                aria-label="Use home directory"
              >
                <ICON_HOME size={14} color="currentColor" />
              </button>
            </div>
            <span
              style={{
                fontFamily: "'Geist Sans', sans-serif",
                fontSize: 10,
                color: "#6B7280",
                lineHeight: 1.5,
              }}
            >
              Agent binary will start with this as its cwd. Leave blank to use Conflux's own working directory.
            </span>
          </div>

          {/* C2-A4b Card color picker */}
          <div className="flex flex-col" style={{ gap: 8, marginTop: 2 }}>
            <span
              style={{
                fontFamily: "'Geist Sans', sans-serif",
                fontSize: 10, fontWeight: 600, letterSpacing: 1.5,
                color: "#6B7280", textTransform: "uppercase" as const,
              }}
            >
              Card Color
            </span>
            <div className="flex flex-wrap" style={{ gap: 8 }}>
              {CARD_COLOR_PRESETS.map((preset) => {
                const isSel = cardColor === preset.color;
                return (
                  <button
                    key={preset.id}
                    onClick={() => setCardColor(preset.color)}
                    title={preset.name}
                    style={{
                      width: 26, height: 26, borderRadius: 9999,
                      background: preset.color,
                      border: isSel ? "2px solid #F2F2F2" : "2px solid transparent",
                      boxShadow: isSel ? `0 0 0 2px ${preset.color}40` : "none",
                      cursor: "pointer", padding: 0,
                      transition: "box-shadow 0.12s, border-color 0.12s",
                    }}
                  />
                );
              })}
            </div>
          </div>

          {error && (
            <div
              style={{
                padding: "10px 14px",
                borderRadius: 8,
                background: "rgba(255,184,0,0.1)",
                border: "1px solid rgba(255,184,0,0.25)",
                fontFamily: "'Geist Sans',sans-serif",
                fontSize: 11,
                color: "#FFB800",
              }}
            >
              {error}
            </div>
          )}
        </div>

        {/* Footer */}
        <div
          className="flex items-center shrink-0"
          style={{ padding: "18px 24px 24px 24px", gap: 10, justifyContent: "flex-end" }}
        >
          <button
            onClick={onClose}
            style={{
              padding: "10px 18px",
              borderRadius: 9999,
              background: "rgba(255,255,255,0.04)",
              border: "1px solid rgba(255,255,255,0.082)",
              fontFamily: "'Geist Sans',sans-serif",
              fontSize: 13,
              fontWeight: 500,
              color: "#B8B3B0",
            }}
          >
            Cancel
          </button>
          <button
            onClick={handleCreate}
            disabled={!selectedId || creating}
            className="flex items-center transition-opacity"
            style={{
              padding: "10px 20px",
              gap: 6,
              borderRadius: 9999,
              background: "#B8D4E3",
              fontFamily: "'Geist Sans',sans-serif",
              fontSize: 13,
              fontWeight: 600,
              color: "#0A0F15",
              opacity: !selectedId || creating ? 0.5 : 1,
              cursor: !selectedId || creating ? "not-allowed" : "pointer",
            }}
          >
            <ICON_ARROW_RIGHT size={14} color="#0A0F15" />
            <span>{creating ? "Creating..." : "Create Agent"}</span>
          </button>
        </div>
      </div>
    </div>
  );
};

export { AddAgentModal };
