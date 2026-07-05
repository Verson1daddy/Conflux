// ===== AddAgentModal =====
// Centered glass modal for picking an adapter and spawning a new agent instance.
// Matches design/conflux.pen frame "AddAgent 弹窗" (FLo0j).

import { type FC, useCallback, useEffect, useState } from "react";
import { open as openDialog } from "@tauri-apps/plugin-dialog";
import {
  createAgentInstance,
  detectAdapterAuth,
  getDefaultWorkingDir,
  listAdapters,
} from "@/lib/tauri-bridge";
import {
  buildAdapterRuntimeBadges,
  getCreateDisabledReason,
} from "@/lib/adapter-runtime";
import {
  CARD_COLOR_PRESETS,
  DEFAULT_CARD_ACCENT_COLOR,
} from "@/lib/agent-visuals";
import { pickWorkingDirectory } from "@/lib/working-directory";
import { Icon, type IconName } from "@/components/ui/Icon";
import { useAgentStore } from "@/stores/agentStore";
import { useWorkspaceStore } from "@/stores/workspaceStore";
import type { AdapterInfo, AdapterAuthStatus, AdapterId, AgentInstanceInfo, CardLayout } from "@/types";

// ===== Smart placement for new cards =====
//
// Walks a coarse grid looking for the first spot where a new card of the
// given size wouldn't overlap any existing card (with a small gap). Falls
// back to a cascading diagonal if every grid slot is taken (which only
// happens past ~100 cards - acceptable for the cascade fallback). This is
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
  // Fallback - every grid slot is taken. Cascade past the last card.
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
  icon: IconName;
}

const VENDOR_META: Record<string, VendorMeta> = {
  "claude-code": { vendor: "anthropic", caption: "anthropic - flagship agent framework", icon: "sparkles" },
  codex: { vendor: "openai", caption: "openai - code-focused reasoning", icon: "terminal" },
  aider: { vendor: "paul-gauthier", caption: "paul-gauthier - git-aware pair programmer", icon: "git-branch" },
  opencode: { vendor: "opencode", caption: "opencode - PR review & codebase triage", icon: "code" },
};

function metaFor(adapterId: string): VendorMeta {
  return VENDOR_META[adapterId] ?? {
    vendor: adapterId,
    caption: `${adapterId} - custom adapter`,
    icon: "box",
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

function getRememberedWorkingDir(): string | null {
  const remembered = localStorage.getItem("conflux.lastWorkingDir");
  if (remembered && remembered.trim().length > 0) return remembered;
  return null;
}

function blockedAdapterStatus(adapterId: string, message: string): AdapterAuthStatus {
  return {
    adapter_id: adapterId,
    ready: false,
    message,
    login_command: null,
    docs_url: null,
    installed: false,
    authenticated: false,
    runnable: false,
    session_supported: false,
    install_message: message,
    auth_message: "Auth not checked because runtime detection failed",
    runtime_message: message,
    session_message: "Session restore support is pending for V1 hardening",
  };
}

const AddAgentModal: FC<AddAgentModalProps> = ({ visible, onClose }) => {
  const addInstance = useAgentStore((s) => s.addInstance);
  const addCard = useWorkspaceStore((s) => s.addCard);
  const favoriteAdapters = useAgentStore((s) => s.favoriteAdapters);
  const primaryAdapterId = useAgentStore((s) => s.primaryAdapter);

  const [adapters, setAdapters] = useState<AdapterInfo[]>([]);
  const [selectedId, setSelectedId] = useState<AdapterId | null>(null);
  const [workingDir, setWorkingDir] = useState<string>("");
  const [displayName, setDisplayName] = useState<string>("");
  const [cardColor, setCardColor] = useState<string>(DEFAULT_CARD_ACCENT_COLOR);
  const setCardColorStore = useAgentStore((s) => s.setCardColor);
  const [loading, setLoading] = useState(false);
  const [creating, setCreating] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [authStatuses, setAuthStatuses] = useState<Map<string, AdapterAuthStatus>>(new Map());
  const [authGuide, setAuthGuide] = useState<AdapterAuthStatus | null>(null);
  const [showAllExpanded, setShowAllExpanded] = useState(false);
  const [backendPreviewOnly, setBackendPreviewOnly] = useState(false);

  // Restore last-used working dir + reset expand state
  useEffect(() => {
    if (!visible) return;
    const remembered = getRememberedWorkingDir();
    if (remembered) {
      setWorkingDir(remembered);
    } else {
      setWorkingDir("");
      getDefaultWorkingDir()
        .then((dir) => {
          const trimmed = dir.trim();
          if (!trimmed) return;
          setWorkingDir((current) => current.trim().length > 0 ? current : trimmed);
        })
        .catch(() => {
          // Backend may be unavailable in preview-only mode; create still
          // falls back to the backend default when possible.
        });
    }
    setShowAllExpanded(false);
  }, [visible]);

  // When adapter selection changes, auto-set color to adapter default
  useEffect(() => {
    if (selectedId) {
      setCardColor(DEFAULT_CARD_ACCENT_COLOR);
    }
  }, [selectedId]);

  // Load adapters + detect auth when modal opens
  useEffect(() => {
    if (!visible) return;
    setLoading(true);
    setError(null);
    setAuthGuide(null);
    setBackendPreviewOnly(false);
    setAuthStatuses(new Map());
    listAdapters()
      .then((list) => {
        setBackendPreviewOnly(false);
        setAdapters(list);
        if (list.length > 0 && selectedId === null) {
          // Default to primary adapter if favorites are configured, else first adapter
          if (favoriteAdapters.size > 0 && primaryAdapterId && list.some((a) => a.id === primaryAdapterId)) {
            setSelectedId(primaryAdapterId);
          } else {
            setSelectedId(list[0].id);
          }
        }
        // Fire auth detection for each adapter (non-blocking)
        for (const adapter of list) {
          detectAdapterAuth(adapter.id)
            .then((status) => {
              setAuthStatuses((prev) => {
                const next = new Map(prev);
                next.set(adapter.id, status);
                return next;
              });
            })
            .catch(() => {
              setAuthStatuses((prev) => {
                const next = new Map(prev);
                next.set(
                  adapter.id,
                  blockedAdapterStatus(adapter.id, "Could not detect adapter runtime")
                );
                return next;
              });
              // Detection failed - treat as unknown (no badge)
            });
        }
      })
      .catch(() => {
        // Backend unavailable - show built-in demo list so user still sees the modal.
        const demo: AdapterInfo[] = [
          { id: "claude-code", name: "Claude Code", command: "claude", capabilities: { can_coordinate: true, coordination_template: null, can_parse_tree: true, can_detect_permission: true }, is_builtin: true },
          { id: "codex", name: "Codex", command: "codex", capabilities: { can_coordinate: false, coordination_template: null, can_parse_tree: false, can_detect_permission: false }, is_builtin: true },
          { id: "aider", name: "Aider", command: "aider", capabilities: { can_coordinate: false, coordination_template: null, can_parse_tree: false, can_detect_permission: false }, is_builtin: true },
          { id: "opencode", name: "OpenCode", command: "opencode", capabilities: { can_coordinate: false, coordination_template: null, can_parse_tree: false, can_detect_permission: false }, is_builtin: true },
        ];
        setBackendPreviewOnly(true);
        setAdapters(demo);
        if (favoriteAdapters.size > 0 && primaryAdapterId && demo.some((a) => a.id === primaryAdapterId)) {
          setSelectedId(primaryAdapterId);
        } else {
          setSelectedId(demo[0].id);
        }
        setError("Backend unavailable - showing built-in adapter list (preview only).");
      })
      .finally(() => setLoading(false));
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [visible]);

  // Escape key to close
  useEffect(() => {
    if (!visible) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [visible, onClose]);

  const handlePickWorkingDir = useCallback(async () => {
    setError(null);
    try {
      const pickedDir = await pickWorkingDirectory(openDialog, workingDir);
      if (pickedDir) setWorkingDir(pickedDir);
    } catch (err) {
      console.error("[AddAgent] open working directory picker failed:", err);
      setError("Could not open folder picker. You can paste a folder path manually.");
    }
  }, [workingDir]);

  const handleCreate = useCallback(async () => {
    if (!selectedId || creating) return;
    const disabledReason = getCreateDisabledReason(authStatuses.get(selectedId), backendPreviewOnly);
    if (disabledReason) {
      setError(disabledReason);
      return;
    }
    setCreating(true);
    setError(null);
    try {
      // Pass workingDir iff user provided one; empty string -> undefined so
      // backend falls back to std::env::current_dir().
      const trimmedDir = workingDir.trim();
      const dirArg = trimmedDir.length > 0 ? trimmedDir : undefined;
      const trimmedName = displayName.trim();
      const nameArg = trimmedName.length > 0 ? trimmedName : undefined;
      const instance: AgentInstanceInfo = await createAgentInstance(
        selectedId,
        dirArg,
        undefined,
        nameArg,
      );
      addInstance(instance);
      // Save user-picked card color
      setCardColorStore(instance.instance_id, cardColor);
      // Size should stay comfortably above the compact minimum (320x220)
      // enforced by AgentCard. Using 620x420 keeps room for header/footer
      // chrome and a few terminal rows.
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
      setDisplayName("");
    } catch (err) {
      const errorMsg = formatBackendError(err);
      console.error("[AddAgent] create_agent_instance failed:", err);

      // Check if this is an auth/login related error - if so, show the
      // guidance modal instead of a plain error toast.
      const authKeywords = ["auth", "login", "api key", "credential", "not authorized", "401", "not found", "not logged in"];
      const lowerMsg = errorMsg.toLowerCase();
      const isAuthError = authKeywords.some((kw) => lowerMsg.includes(kw));

      if (isAuthError && selectedId) {
        // Try to use cached auth status, or construct a fallback
        const cached = authStatuses.get(selectedId);
        if (cached && !cached.ready) {
          setAuthGuide(cached);
        } else {
          // Construct a minimal guide from the error message
          setAuthGuide(blockedAdapterStatus(selectedId, errorMsg));
        }
      } else {
        setError(errorMsg);
      }
    } finally {
      setCreating(false);
    }
  }, [selectedId, creating, workingDir, displayName, cardColor, addInstance, addCard, setCardColorStore, onClose, authStatuses, backendPreviewOnly]);

  if (!visible) return null;

  const selectedRuntimeStatus = selectedId ? authStatuses.get(selectedId) : undefined;
  const createDisabledReason = selectedId
    ? getCreateDisabledReason(selectedRuntimeStatus, backendPreviewOnly)
    : "Select an adapter";
  const createDisabled = creating || createDisabledReason !== null;

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center"
      role="dialog"
      aria-modal="true"
      aria-label="New Agent"
    >
      {/* Backdrop */}
      <div
        className="absolute inset-0 modal-scrim-enter"
        style={{ background: "rgba(0,0,0,0.53)", backdropFilter: "blur(6px)", WebkitBackdropFilter: "blur(6px)" }}
        onClick={onClose}
        aria-hidden="true"
      />

      {/* Modal card */}
      <div
        className="relative flex flex-col overflow-hidden modal-panel-enter"
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
            <Icon name="close" size={17} />
          </button>
        </div>

        {/* Divider */}
        <div style={{ height: 1, background: "rgba(255,255,255,0.082)" }} />

        {/* Body */}
        <div className="flex-1 overflow-y-auto flex flex-col" style={{ padding: "22px 24px", gap: 14 }}>
          {loading ? (
            <div style={{ padding: "24px", textAlign: "center", color: "#6B7280", fontFamily: "'Geist Sans',sans-serif", fontSize: 12 }}>
              Loading adapters...
            </div>
          ) : adapters.length === 0 ? (
            <div style={{ padding: "24px", textAlign: "center", color: "#6B7280", fontFamily: "'Geist Sans',sans-serif", fontSize: 12 }}>
              No adapters registered.
            </div>
          ) : (() => {
            const hasFavorites = favoriteAdapters.size > 0;
            const favList = hasFavorites ? adapters.filter((a) => favoriteAdapters.has(a.id)) : [];
            const otherList = hasFavorites ? adapters.filter((a) => !favoriteAdapters.has(a.id)) : [];

            const sectionLabelStyle = {
              fontFamily: "'Geist Sans', sans-serif",
              fontSize: 10,
              fontWeight: 600,
              letterSpacing: 1.5,
              color: "#6B7280",
              textTransform: "uppercase" as const,
            };

            const renderAdapterRow = (adapter: AdapterInfo) => {
              const isSelected = selectedId === adapter.id;
              const meta = metaFor(adapter.id);
              const authStatus = authStatuses.get(adapter.id);
              const runtimeBadges = buildAdapterRuntimeBadges(authStatus, backendPreviewOnly);
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
                    <span style={{ color: isSelected ? "#B8D4E3" : "#B8B3B0", display: "inline-flex" }}>
                      <Icon name={meta.icon} size={18} />
                    </span>
                  </div>

                  {/* Name + caption */}
                  <div className="flex-1 min-w-0 flex flex-col" style={{ gap: 3 }}>
                    <div className="flex items-center" style={{ gap: 8 }}>
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
                    </div>
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
                    <div className="flex flex-wrap" style={{ gap: 4, marginTop: 5 }}>
                      {runtimeBadges.map((badge) => (
                        <span
                          key={badge.id}
                          title={badge.detail}
                          style={{
                            fontFamily: "'Geist Sans',sans-serif",
                            fontSize: 9,
                            fontWeight: 600,
                            padding: "2px 6px",
                            borderRadius: 9999,
                            letterSpacing: 0,
                            background:
                              badge.tone === "ok"
                                ? "rgba(52,199,89,0.14)"
                                : badge.tone === "warn"
                                  ? "rgba(255,184,0,0.14)"
                                  : "rgba(255,255,255,0.055)",
                            color:
                              badge.tone === "ok"
                                ? "#34C759"
                                : badge.tone === "warn"
                                  ? "#FFB800"
                                  : "#8A8F98",
                            border: `1px solid ${
                              badge.tone === "ok"
                                ? "rgba(52,199,89,0.26)"
                                : badge.tone === "warn"
                                  ? "rgba(255,184,0,0.26)"
                                  : "rgba(255,255,255,0.09)"
                            }`,
                            whiteSpace: "nowrap" as const,
                          }}
                        >
                          {badge.label}
                        </span>
                      ))}
                    </div>
                  </div>
                </button>
              );
            };

            // If no favorites configured (not onboarded), show all as before
            if (!hasFavorites) {
              return (
                <>
                  <span style={sectionLabelStyle}>Available Adapters</span>
                  <div className="flex flex-col" style={{ gap: 8 }}>
                    {adapters.map(renderAdapterRow)}
                  </div>
                </>
              );
            }

            // Favorites + collapsible "Show all"
            return (
              <>
                {/* FAVORITES section */}
                <span style={sectionLabelStyle}>Favorites</span>
                <div className="flex flex-col" style={{ gap: 8 }}>
                  {favList.length > 0 ? favList.map(renderAdapterRow) : (
                    <div style={{ padding: "12px", fontFamily: "'Geist Sans',sans-serif", fontSize: 12, color: "#6B7280", textAlign: "center" }}>
                      No favorites selected
                    </div>
                  )}
                </div>

                {/* Show all frameworks toggle */}
                {otherList.length > 0 && (
                  <>
                    <button
                      onClick={() => setShowAllExpanded((p) => !p)}
                      className="flex items-center w-full"
                      style={{
                        padding: "8px 0", gap: 6, background: "none", border: "none",
                        cursor: "pointer",
                      }}
                    >
                      <span style={sectionLabelStyle}>
                        {showAllExpanded ? "Hide other frameworks" : "Show all frameworks"}
                      </span>
                      <span
                        style={{
                          color: "#6B7280",
                          display: "inline-flex",
                          transform: showAllExpanded ? "rotate(180deg)" : "rotate(0deg)",
                          transition: "transform 0.15s",
                        }}
                      >
                        <Icon name="chevron-down" size={14} />
                      </span>
                    </button>
                    {showAllExpanded && (
                      <div className="flex flex-col" style={{ gap: 8 }}>
                        {otherList.map(renderAdapterRow)}
                      </div>
                    )}
                  </>
                )}
              </>
            );
          })()}

          {/* Working Directory section */}
          <div className="flex flex-col" style={{ gap: 10, marginTop: 6 }}>
            <div className="flex items-center" style={{ gap: 8 }}>
              <span style={{ color: "#6B7280", display: "inline-flex" }}>
                <Icon name="folder" size={14} />
              </span>
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
                onClick={handlePickWorkingDir}
                className="shrink-0 flex items-center justify-center transition-colors"
                style={{
                  width: 36,
                  height: 36,
                  background: "rgba(255,255,255,0.055)",
                  border: "1px solid rgba(255,255,255,0.082)",
                  borderRadius: 8,
                  color: "#B8B3B0",
                }}
                title="Choose working directory"
                aria-label="Choose working directory"
              >
                <Icon name="folder" size={16} />
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
              Agent binary will start with this as its cwd. Leave blank to use your default working directory.
            </span>
          </div>

          {/* Instance nickname */}
          <div className="flex flex-col" style={{ gap: 6, marginTop: 2 }}>
            <span
              style={{
                fontFamily: "'Geist Sans', sans-serif",
                fontSize: 10, fontWeight: 600, letterSpacing: 1.5,
                color: "#6B7280", textTransform: "uppercase" as const,
              }}
            >
              Nickname (optional)
            </span>
            <input
              type="text"
              value={displayName}
              onChange={(e) => setDisplayName(e.target.value)}
              placeholder="e.g. Frontend, Backend, Reviewer..."
              className="outline-none"
              maxLength={32}
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
            <span
              style={{
                fontFamily: "'Geist Sans', sans-serif",
                fontSize: 10,
                color: "#6B7280",
                lineHeight: 1.5,
              }}
            >
              Helps tell apart multiple instances of the same adapter. Shows as "Adapter - Nickname".
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
            disabled={createDisabled}
            title={createDisabledReason ?? "Create agent"}
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
              opacity: createDisabled ? 0.5 : 1,
              cursor: createDisabled ? "not-allowed" : "pointer",
            }}
          >
            <Icon name="arrow-right" size={16} strokeWidth={2.5} />
            <span>{creating ? "Creating..." : "Create Agent"}</span>
          </button>
        </div>

        {/* Auth guidance overlay */}
        {authGuide && (
          <div
            className="absolute inset-0 flex items-center justify-center"
            style={{
              background: "rgba(0,0,0,0.7)",
              backdropFilter: "blur(4px)",
              borderRadius: 12,
              zIndex: 10,
            }}
          >
            <div
              className="flex flex-col"
              style={{
                width: 360,
                padding: "28px 24px",
                gap: 16,
                background: "rgba(20,20,28,0.95)",
                border: "1px solid rgba(255,184,0,0.25)",
                borderRadius: 12,
                boxShadow: "0 8px 32px rgba(0,0,0,0.5)",
              }}
            >
              {/* Title */}
              <div className="flex items-center" style={{ gap: 10 }}>
                <div
                  style={{
                    width: 32, height: 32, borderRadius: 8,
                    background: "rgba(255,184,0,0.12)",
                    display: "flex", alignItems: "center", justifyContent: "center",
                  }}
                >
                  <span style={{ color: "#FFB800", display: "inline-flex" }}>
                    <Icon name="info" size={16} />
                  </span>
                </div>
                <span
                  style={{
                    fontFamily: "'Fraunces Variable', Georgia, serif",
                    fontSize: 18,
                    fontWeight: 600,
                    color: "#F2F2F2",
                  }}
                >
                  Setup Required
                </span>
              </div>

              {/* Message */}
              <p
                style={{
                  fontFamily: "'Geist Sans', sans-serif",
                  fontSize: 12,
                  color: "#B8B3B0",
                  lineHeight: 1.6,
                  margin: 0,
                }}
              >
                {authGuide.message}
              </p>

              {/* Login command */}
              {authGuide.login_command && (
                <div
                  className="flex items-center"
                  style={{
                    padding: "10px 14px",
                    gap: 10,
                    borderRadius: 8,
                    background: "rgba(255,255,255,0.04)",
                    border: "1px solid rgba(255,255,255,0.08)",
                  }}
                >
                  <code
                    style={{
                      flex: 1,
                      fontFamily: "'JetBrains Mono Variable', monospace",
                      fontSize: 12,
                      color: "#B8D4E3",
                      wordBreak: "break-all",
                    }}
                  >
                    {authGuide.login_command}
                  </code>
                  <button
                    onClick={() => {
                      if (authGuide.login_command) {
                        navigator.clipboard.writeText(authGuide.login_command);
                      }
                    }}
                    className="shrink-0"
                    style={{
                      padding: "5px 10px",
                      borderRadius: 6,
                      background: "rgba(184,212,227,0.12)",
                      border: "1px solid rgba(184,212,227,0.2)",
                      fontFamily: "'Geist Sans', sans-serif",
                      fontSize: 10,
                      fontWeight: 600,
                      color: "#B8D4E3",
                      cursor: "pointer",
                    }}
                  >
                    Copy
                  </button>
                </div>
              )}

              {/* Actions */}
              <div className="flex items-center" style={{ gap: 10, justifyContent: "flex-end", marginTop: 4 }}>
                {authGuide.docs_url && (
                  <button
                    onClick={() => {
                      if (authGuide.docs_url) {
                        window.open(authGuide.docs_url, "_blank");
                      }
                    }}
                    style={{
                      padding: "8px 16px",
                      borderRadius: 9999,
                      background: "rgba(255,255,255,0.04)",
                      border: "1px solid rgba(255,255,255,0.082)",
                      fontFamily: "'Geist Sans', sans-serif",
                      fontSize: 12,
                      fontWeight: 500,
                      color: "#B8B3B0",
                      cursor: "pointer",
                    }}
                  >
                    View Docs
                  </button>
                )}
                <button
                  onClick={() => setAuthGuide(null)}
                  style={{
                    padding: "8px 16px",
                    borderRadius: 9999,
                    background: "rgba(255,184,0,0.15)",
                    border: "1px solid rgba(255,184,0,0.3)",
                    fontFamily: "'Geist Sans', sans-serif",
                    fontSize: 12,
                    fontWeight: 600,
                    color: "#FFB800",
                    cursor: "pointer",
                  }}
                >
                  Got it
                </button>
              </div>
            </div>
          </div>
        )}
      </div>
    </div>
  );
};

export { AddAgentModal };
