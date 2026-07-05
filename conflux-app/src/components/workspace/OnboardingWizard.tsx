// ===== OnboardingWizard =====
// C2-B1 Tasks 10: 3-step onboarding wizard.
// Step 1: Choose favorite frameworks (checkbox multi-select, >= 1 required)
// Step 2: Choose primary framework (radio single-select from favorites)
// Step 3: Create first agent instance (adapter dropdown + working dir + auth check)
//
// Guarded by localStorage["conflux.onboarded.v1"] in App.tsx.
// On complete: persists favorites, primary, optionally creates first agent.

import { type FC, useCallback, useEffect, useMemo, useState } from "react";
import { Icon } from "@/components/ui/Icon";
import { createAgentInstance, detectAdapterAuth } from "@/lib/tauri-bridge";
import { getCreateDisabledReason } from "@/lib/adapter-runtime";
import { useAgentStore } from "@/stores/agentStore";
import { useWorkspaceStore } from "@/stores/workspaceStore";
import type { AdapterAuthStatus } from "@/types";

// ===== Adapter metadata =====

interface BuiltinAdapter {
  id: string;
  name: string;
  desc: string;
  color: string;
}

const BUILTIN_ADAPTERS: BuiltinAdapter[] = [
  { id: "claude-code", name: "Claude Code", desc: "Anthropic CLI agent", color: "#B8D4E3" },
  { id: "codex", name: "Codex", desc: "OpenAI CLI agent", color: "#FFB800" },
  { id: "aider", name: "Aider", desc: "Pair programming agent", color: "#8EA4B8" },
  { id: "opencode", name: "OpenCode", desc: "Open-source CLI agent", color: "#C9B894" },
];

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

// ===== Component =====

interface OnboardingWizardProps {
  visible?: boolean;
  onComplete: () => void;
}

type WizardStep = 1 | 2 | 3;

const OnboardingWizard: FC<OnboardingWizardProps> = ({ visible = true, onComplete }) => {
  const [step, setStep] = useState<WizardStep>(1);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [primary, setPrimary] = useState<string | null>(null);

  // Step 3 state
  const [createAdapterId, setCreateAdapterId] = useState<string>("");
  const [workingDir, setWorkingDir] = useState<string>(
    () => localStorage.getItem("conflux.lastWorkingDir") || ""
  );
  const [authStatus, setAuthStatus] = useState<AdapterAuthStatus | null>(null);
  const [authLoading, setAuthLoading] = useState(false);
  const [creating, setCreating] = useState(false);
  const [createError, setCreateError] = useState<string | null>(null);
  const [dropdownOpen, setDropdownOpen] = useState(false);

  // Store actions
  const addInstance = useAgentStore((s) => s.addInstance);
  const setCardColor = useAgentStore((s) => s.setCardColor);
  const setFavoriteAdapters = useAgentStore((s) => s.setFavoriteAdapters);
  const setPrimaryAdapter = useAgentStore((s) => s.setPrimaryAdapter);
  const addCard = useWorkspaceStore((s) => s.addCard);

  // Filtered adapters for step 2 and step 3
  const favoriteAdapters = useMemo(
    () => BUILTIN_ADAPTERS.filter((a) => selected.has(a.id)),
    [selected]
  );

  // When entering step 3, default the create adapter to the primary
  useEffect(() => {
    if (step === 3 && primary && !createAdapterId) {
      setCreateAdapterId(primary);
    }
  }, [step, primary, createAdapterId]);

  // Auth detection: run on mount of step 3 and when adapter changes
  useEffect(() => {
    if (step !== 3 || !createAdapterId) return;
    let cancelled = false;
    setAuthLoading(true);
    setAuthStatus(null);
    detectAdapterAuth(createAdapterId)
      .then((status) => {
        if (!cancelled) setAuthStatus(status);
      })
      .catch(() => {
        if (!cancelled) {
          setAuthStatus(blockedAdapterStatus(createAdapterId, "Could not detect adapter runtime"));
        }
      })
      .finally(() => {
        if (!cancelled) setAuthLoading(false);
      });
    return () => { cancelled = true; };
  }, [step, createAdapterId]);

  // ===== Handlers =====

  const toggleAdapter = useCallback((id: string) => {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(id)) {
        next.delete(id);
      } else {
        next.add(id);
      }
      return next;
    });
  }, []);

  // When deselecting an adapter that is the primary, clear primary
  useEffect(() => {
    if (primary && !selected.has(primary)) {
      setPrimary(null);
    }
  }, [selected, primary]);

  const handleNext = useCallback(() => {
    if (step === 1 && selected.size >= 1) {
      if (selected.size === 1) {
        setPrimary([...selected][0]);
      }
      setStep(2);
    } else if (step === 2 && primary) {
      setStep(3);
    }
  }, [step, selected, primary]);

  const handleBack = useCallback(() => {
    if (step === 2) setStep(1);
    else if (step === 3) {
      setCreateError(null);
      setStep(2);
    }
  }, [step]);

  const finishOnboarding = useCallback(() => {
    setFavoriteAdapters(selected);
    setPrimaryAdapter(primary);
    localStorage.setItem("conflux.onboarded.v1", "true");
    onComplete();
  }, [selected, primary, setFavoriteAdapters, setPrimaryAdapter, onComplete]);

  const handleCreate = useCallback(async () => {
    if (!createAdapterId || creating) return;
    const disabledReason = getCreateDisabledReason(authStatus ?? undefined, false);
    if (disabledReason) {
      setCreateError(disabledReason);
      return;
    }
    setCreating(true);
    setCreateError(null);

    const adapterMeta = BUILTIN_ADAPTERS.find((a) => a.id === createAdapterId);
    const adapterColor = adapterMeta?.color || "#B8D4E3";
    const dir = workingDir.trim() || undefined;

    // Persist working dir for future use
    if (dir) {
      localStorage.setItem("conflux.lastWorkingDir", dir);
    }

    try {
      const info = await createAgentInstance(createAdapterId, dir);
      addInstance(info);
      setCardColor(info.instance_id, adapterColor);
      addCard({
        instance_id: info.instance_id,
        position: { x: 24, y: 24 },
        size: { width: 580, height: 380 },
        z_index: 1,
      });
      finishOnboarding();
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : String(err);
      // Provide guidance for auth-related errors
      if (authStatus && !authStatus.ready && authStatus.login_command) {
        setCreateError(
          `${message}\n\nTry running: ${authStatus.login_command}`
        );
      } else {
        setCreateError(message);
      }
    } finally {
      setCreating(false);
    }
  }, [createAdapterId, creating, workingDir, authStatus, addInstance, setCardColor, addCard, finishOnboarding]);

  const handleSkip = useCallback(() => {
    finishOnboarding();
  }, [finishOnboarding]);

  if (!visible) return null;

  // ===== Rendering helpers =====

  const canNext1 = selected.size >= 1;
  const canNext2 = primary !== null;

  const currentAdapter = BUILTIN_ADAPTERS.find((a) => a.id === createAdapterId);
  const createDisabledReason = createAdapterId
    ? getCreateDisabledReason(authStatus ?? undefined, false)
    : "Choose an adapter";
  const createDisabled = creating || createDisabledReason !== null;

  return (
    <div
      style={{
        position: "fixed",
        inset: 0,
        zIndex: 50,
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        background: "rgba(5,5,7,0.85)",
        backdropFilter: "blur(12px)",
        WebkitBackdropFilter: "blur(12px)",
      }}
    >
      <div
        style={{
          width: 480,
          maxHeight: "88vh",
          display: "flex",
          flexDirection: "column",
          overflow: "hidden",
          background: "rgba(255,255,255,0.04)",
          backdropFilter: "blur(24px)",
          WebkitBackdropFilter: "blur(24px)",
          border: "1px solid rgba(255,255,255,0.13)",
          borderRadius: 16,
          boxShadow: "0 24px 64px rgba(0,0,0,0.5), 0 0 0 1px rgba(255,255,255,0.04) inset",
        }}
      >
        {/* Header */}
        <div style={{ padding: "32px 36px 24px 36px", flexShrink: 0 }}>
          <h1 style={{
            fontFamily: "'Fraunces Variable',Georgia,serif",
            fontSize: step === 1 ? 28 : 24,
            fontWeight: 700,
            color: "#F2F2F2",
            letterSpacing: -0.3,
            margin: 0,
            lineHeight: 1.2,
          }}>
            {step === 1 && "Welcome to Conflux"}
            {step === 2 && "Choose Default Adapter"}
            {step === 3 && "Create your first agent"}
          </h1>
          <p style={{
            fontFamily: "'Geist Sans',sans-serif",
            fontSize: step === 1 ? 14 : 13,
            color: "#6B7280",
            margin: "8px 0 0 0",
            lineHeight: 1.5,
          }}>
            {step === 1 && "Pick the frameworks you use"}
            {step === 2 && "Used for new instances and as discussion moderator"}
            {step === 3 && "Let's make sure it works"}
          </p>
          {/* Step indicator */}
          <div style={{ display: "flex", alignItems: "center", gap: 6, marginTop: 12 }}>
            {([1, 2, 3] as const).map((s) => (
              <div
                key={s}
                style={{
                  width: 24,
                  height: 3,
                  borderRadius: 2,
                  background: s <= step ? "#B8D4E3" : "rgba(255,255,255,0.12)",
                  transition: "background 0.2s",
                }}
              />
            ))}
          </div>
        </div>

        {/* Divider */}
        <div style={{ height: 1, background: "rgba(255,255,255,0.082)", flexShrink: 0 }} />

        {/* Body */}
        <div style={{
          flex: 1,
          overflowY: "auto",
          padding: "20px 28px",
          display: "flex",
          flexDirection: "column",
          gap: 10,
        }}>
          {/* ===== STEP 1: Choose Favorites ===== */}
          {step === 1 && BUILTIN_ADAPTERS.map((a) => {
            const isSel = selected.has(a.id);
            return (
              <button
                key={a.id}
                onClick={() => toggleAdapter(a.id)}
                title={isSel ? `Deselect ${a.name}` : `Select ${a.name}`}
                style={{
                  display: "flex",
                  alignItems: "center",
                  width: "100%",
                  height: 64,
                  padding: "0 18px",
                  gap: 14,
                  borderRadius: 10,
                  background: isSel ? "rgba(184,212,227,0.08)" : "rgba(255,255,255,0.03)",
                  border: isSel ? "1px solid #B8D4E3" : "1px solid rgba(255,255,255,0.082)",
                  cursor: "pointer",
                  textAlign: "left",
                  transition: "background 0.15s, border-color 0.15s",
                }}
              >
                {/* Color block */}
                <div style={{
                  width: 40,
                  height: 40,
                  borderRadius: 8,
                  background: a.color,
                  flexShrink: 0,
                  opacity: isSel ? 1 : 0.6,
                  transition: "opacity 0.15s",
                }} />
                {/* Text */}
                <div style={{ flex: 1, minWidth: 0, display: "flex", flexDirection: "column", gap: 2 }}>
                  <span style={{
                    fontFamily: "'Geist Sans',sans-serif",
                    fontSize: 14,
                    fontWeight: 600,
                    color: "#F2F2F2",
                  }}>
                    {a.name}
                  </span>
                  <span style={{
                    fontFamily: "'Geist Sans',sans-serif",
                    fontSize: 11,
                    color: "#6B7280",
                  }}>
                    {a.desc}
                  </span>
                </div>
                {/* Checkbox */}
                <div style={{
                  width: 22,
                  height: 22,
                  borderRadius: 6,
                  flexShrink: 0,
                  display: "flex",
                  alignItems: "center",
                  justifyContent: "center",
                  background: isSel ? "#B8D4E3" : "rgba(255,255,255,0.06)",
                  border: isSel ? "none" : "1px solid rgba(255,255,255,0.15)",
                  transition: "background 0.15s",
                }}>
                  {isSel && (
                    <span style={{ color: "#0A0F15", display: "inline-flex" }}>
                      <Icon name="check" size={14} />
                    </span>
                  )}
                </div>
              </button>
            );
          })}

          {step === 1 && (
            <p style={{
              fontFamily: "'Geist Sans',sans-serif",
              fontSize: 12,
              color: "#6B7280",
              textAlign: "center",
              margin: "4px 0 0 0",
            }}>
              Select at least one to continue
            </p>
          )}

          {/* ===== STEP 2: Choose Primary ===== */}
          {step === 2 && favoriteAdapters.map((a) => {
            const isPrimary = primary === a.id;
            return (
              <button
                key={a.id}
                onClick={() => setPrimary(a.id)}
                title={`Set ${a.name} as default adapter`}
                style={{
                  display: "flex",
                  alignItems: "center",
                  width: "100%",
                  height: 64,
                  padding: "0 18px",
                  gap: 14,
                  borderRadius: 10,
                  background: isPrimary ? "rgba(184,212,227,0.08)" : "rgba(255,255,255,0.03)",
                  border: isPrimary ? "1px solid #B8D4E3" : "1px solid rgba(255,255,255,0.082)",
                  cursor: "pointer",
                  textAlign: "left",
                  transition: "background 0.15s, border-color 0.15s",
                }}
              >
                {/* Color block */}
                <div style={{
                  width: 40,
                  height: 40,
                  borderRadius: 8,
                  background: a.color,
                  flexShrink: 0,
                  opacity: isPrimary ? 1 : 0.6,
                  transition: "opacity 0.15s",
                }} />
                {/* Text */}
                <div style={{ flex: 1, minWidth: 0, display: "flex", flexDirection: "column", gap: 2 }}>
                  <span style={{
                    fontFamily: "'Geist Sans',sans-serif",
                    fontSize: 14,
                    fontWeight: 600,
                    color: "#F2F2F2",
                  }}>
                    {a.name}
                  </span>
                  <span style={{
                    fontFamily: "'Geist Sans',sans-serif",
                    fontSize: 11,
                    color: "#6B7280",
                  }}>
                    {a.desc}
                  </span>
                </div>
                {/* Radio circle */}
                <div style={{
                  width: 22,
                  height: 22,
                  borderRadius: 9999,
                  flexShrink: 0,
                  display: "flex",
                  alignItems: "center",
                  justifyContent: "center",
                  background: isPrimary ? "#B8D4E3" : "rgba(255,255,255,0.06)",
                  border: isPrimary ? "none" : "1px solid rgba(255,255,255,0.15)",
                  transition: "background 0.15s",
                }}>
                  {isPrimary && (
                    <div style={{
                      width: 10,
                      height: 10,
                      borderRadius: 9999,
                      background: "#0A0F15",
                    }} />
                  )}
                </div>
              </button>
            );
          })}

          {/* ===== STEP 3: Create First Agent ===== */}
          {step === 3 && (
            <>
              {/* Framework dropdown */}
              <label style={{
                fontFamily: "'Geist Sans',sans-serif",
                fontSize: 12,
                fontWeight: 500,
                color: "#B8B3B0",
                marginBottom: 2,
              }}>
                Framework
              </label>
              <div style={{ position: "relative" }}>
                <button
                  onClick={() => setDropdownOpen((v) => !v)}
                  title="Select framework"
                  style={{
                    display: "flex",
                    alignItems: "center",
                    width: "100%",
                    height: 44,
                    padding: "0 14px",
                    gap: 10,
                    borderRadius: 8,
                    background: "rgba(255,255,255,0.04)",
                    border: "1px solid rgba(255,255,255,0.10)",
                    cursor: "pointer",
                    textAlign: "left",
                  }}
                >
                  {currentAdapter && (
                    <div style={{
                      width: 24,
                      height: 24,
                      borderRadius: 6,
                      background: currentAdapter.color,
                      flexShrink: 0,
                    }} />
                  )}
                  <span style={{
                    fontFamily: "'Geist Sans',sans-serif",
                    fontSize: 13,
                    color: "#F2F2F2",
                    flex: 1,
                  }}>
                    {currentAdapter?.name || "Select framework"}
                  </span>
                  <span style={{ color: "#6B7280", display: "inline-flex" }}>
                    <Icon name="chevron-down" size={16} />
                  </span>
                </button>
                {dropdownOpen && (
                  <div style={{
                    position: "absolute",
                    top: "calc(100% + 4px)",
                    left: 0,
                    right: 0,
                    zIndex: 10,
                    background: "rgba(28,30,34,0.98)",
                    border: "1px solid rgba(255,255,255,0.12)",
                    borderRadius: 8,
                    padding: 4,
                    boxShadow: "0 8px 32px rgba(0,0,0,0.4)",
                  }}>
                    {favoriteAdapters.map((a) => (
                      <button
                        key={a.id}
                        onClick={() => {
                          setCreateAdapterId(a.id);
                          setDropdownOpen(false);
                          setCreateError(null);
                        }}
                        title={a.name}
                        style={{
                          display: "flex",
                          alignItems: "center",
                          width: "100%",
                          height: 38,
                          padding: "0 10px",
                          gap: 10,
                          borderRadius: 6,
                          background: createAdapterId === a.id ? "rgba(184,212,227,0.10)" : "transparent",
                          border: "none",
                          cursor: "pointer",
                          textAlign: "left",
                        }}
                      >
                        <div style={{
                          width: 20,
                          height: 20,
                          borderRadius: 5,
                          background: a.color,
                          flexShrink: 0,
                        }} />
                        <span style={{
                          fontFamily: "'Geist Sans',sans-serif",
                          fontSize: 13,
                          color: "#F2F2F2",
                        }}>
                          {a.name}
                        </span>
                      </button>
                    ))}
                  </div>
                )}
              </div>

              {/* Working directory */}
              <label style={{
                fontFamily: "'Geist Sans',sans-serif",
                fontSize: 12,
                fontWeight: 500,
                color: "#B8B3B0",
                marginTop: 8,
                marginBottom: 2,
              }}>
                Working directory
              </label>
              <input
                type="text"
                value={workingDir}
                onChange={(e) => setWorkingDir(e.target.value)}
                placeholder="D:\Projects\my-app"
                style={{
                  width: "100%",
                  height: 44,
                  padding: "0 14px",
                  borderRadius: 8,
                  background: "rgba(255,255,255,0.04)",
                  border: "1px solid rgba(255,255,255,0.10)",
                  fontFamily: "'Geist Sans',sans-serif",
                  fontSize: 13,
                  color: "#F2F2F2",
                  outline: "none",
                  boxSizing: "border-box",
                }}
              />

              {/* Auth status badge */}
              <div style={{
                display: "flex",
                alignItems: "center",
                gap: 8,
                marginTop: 8,
                padding: "8px 0",
              }}>
                {authLoading ? (
                  <>
                    <div style={{
                      width: 8,
                      height: 8,
                      borderRadius: 9999,
                      background: "#6B7280",
                      animation: "pulse 1.5s ease-in-out infinite",
                    }} />
                    <span style={{
                      fontFamily: "'Geist Sans',sans-serif",
                      fontSize: 12,
                      color: "#6B7280",
                    }}>
                      Checking auth...
                    </span>
                  </>
                ) : authStatus ? (
                  <>
                    <div style={{
                      width: 8,
                      height: 8,
                      borderRadius: 9999,
                      background: authStatus.ready ? "#5FD47F" : "#FFB800",
                    }} />
                    <span style={{
                      fontFamily: "'Geist Sans',sans-serif",
                      fontSize: 12,
                      color: authStatus.ready ? "#5FD47F" : "#FFB800",
                    }}>
                      {authStatus.ready ? "Ready" : "Setup needed"}
                    </span>
                    {!authStatus.ready && authStatus.login_command && (
                      <span style={{
                        fontFamily: "'Geist Sans',sans-serif",
                        fontSize: 11,
                        color: "#6B7280",
                        marginLeft: 4,
                      }}>
                        Run: {authStatus.login_command}
                      </span>
                    )}
                  </>
                ) : null}
              </div>

              {/* Create error */}
              {createError && (
                <div style={{
                  fontFamily: "'Geist Sans',sans-serif",
                  fontSize: 12,
                  color: "#FF6B6B",
                  lineHeight: 1.5,
                  whiteSpace: "pre-wrap",
                  padding: "8px 12px",
                  borderRadius: 8,
                  background: "rgba(255,107,107,0.08)",
                  border: "1px solid rgba(255,107,107,0.20)",
                }}>
                  {createError}
                </div>
              )}
            </>
          )}
        </div>

        {/* Footer */}
        <div style={{ height: 1, background: "rgba(255,255,255,0.06)", flexShrink: 0 }} />
        <div style={{
          display: "flex",
          alignItems: "center",
          justifyContent: "space-between",
          padding: "18px 28px",
          flexShrink: 0,
        }}>
          {/* Left side */}
          {step === 1 ? (
            <span style={{
              fontFamily: "'Geist Sans',sans-serif",
              fontSize: 11,
              color: "rgba(107,114,128,0.38)",
            }}>
              {selected.size} selected
            </span>
          ) : (
            <button
              onClick={handleBack}
              title="Go back to previous step"
              style={{
                display: "flex",
                alignItems: "center",
                gap: 6,
                padding: "10px 18px",
                borderRadius: 9999,
                background: "rgba(255,255,255,0.04)",
                border: "1px solid rgba(255,255,255,0.082)",
                fontFamily: "'Geist Sans',sans-serif",
                fontSize: 13,
                fontWeight: 500,
                color: "#B8B3B0",
                cursor: "pointer",
              }}
            >
              <span style={{ color: "#B8B3B0", display: "inline-flex" }}>
                <Icon name="arrow-left" size={14} />
              </span>
              <span>Back</span>
            </button>
          )}

          {/* Right side */}
          <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
            {step === 3 && (
              <button
                onClick={handleSkip}
                title="Skip agent creation and finish setup"
                style={{
                  background: "none",
                  border: "none",
                  fontFamily: "'Geist Sans',sans-serif",
                  fontSize: 12,
                  color: "#6B7280",
                  textDecoration: "underline",
                  cursor: "pointer",
                  padding: "4px 8px",
                }}
              >
                I'll do this later
              </button>
            )}
            <button
              onClick={step === 3 ? handleCreate : handleNext}
              disabled={
                (step === 1 && !canNext1) ||
                (step === 2 && !canNext2) ||
                (step === 3 && createDisabled)
              }
              title={step === 1 ? "Continue to adapter selection" : step === 2 ? "Continue to agent creation" : creating ? "Creating agent..." : createDisabledReason ?? "Create a new agent instance"}
              style={{
                display: "flex",
                alignItems: "center",
                gap: 8,
                padding: "10px 22px",
                borderRadius: 9999,
                background: "#B8D4E3",
                border: "none",
                fontFamily: "'Geist Sans',sans-serif",
                fontSize: 13,
                fontWeight: 600,
                color: "#0A0F15",
                opacity:
                  (step === 1 && !canNext1) ||
                  (step === 2 && !canNext2) ||
                  (step === 3 && createDisabled)
                    ? 0.4
                    : 1,
                cursor:
                  (step === 1 && !canNext1) ||
                  (step === 2 && !canNext2) ||
                  (step === 3 && createDisabled)
                    ? "not-allowed"
                    : "pointer",
                transition: "opacity 0.15s",
              }}
            >
              {step === 3 && creating && (
                <span
                  className="animate-spin"
                  style={{
                    display: "inline-block",
                    width: 14,
                    height: 14,
                    borderRadius: 9999,
                    border: "2px solid rgba(10,15,21,0.2)",
                    borderTopColor: "#0A0F15",
                    flexShrink: 0,
                  }}
                />
              )}
              <span>
                {step === 1 && "Next"}
                {step === 2 && "Get Started"}
                {step === 3 && (creating ? "Creating..." : "Create Agent")}
              </span>
              {!(step === 3 && creating) && (
                <span style={{ color: "#0A0F15", display: "inline-flex" }}>
                  <Icon name="arrow-right" size={16} />
                </span>
              )}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
};

export { OnboardingWizard };
