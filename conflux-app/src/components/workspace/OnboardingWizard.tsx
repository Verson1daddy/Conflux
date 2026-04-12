// ===== OnboardingWizard =====
// C2-A3: First-launch wizard for selecting favorite frameworks + primary adapter.
// Two steps: 1) Pick favorites (≥1), 2) Choose primary from favorites.
// Guarded by localStorage["conflux.onboarded.v1"] — shows once, never again
// unless localStorage is cleared.
//
// Visual: full-screen modal with glass card (560×auto), Conflux branding,
// same glass tokens as Settings/AddAgent panels.

import { type FC, useCallback, useState } from "react";
import { useAgentStore } from "@/stores/agentStore";

// ===== Adapter metadata =====

interface AdapterMeta {
  id: string;
  name: string;
  vendor: string;
  description: string;
}

const ALL_ADAPTERS: AdapterMeta[] = [
  { id: "claude-code", name: "Claude Code", vendor: "Anthropic", description: "Flagship agent framework with sub-agent orchestration" },
  { id: "codex", name: "Codex", vendor: "OpenAI", description: "Code-focused reasoning and analysis" },
  { id: "aider", name: "Aider", vendor: "Paul Gauthier", description: "Git-aware pair programmer" },
  { id: "opencode", name: "OpenCode", vendor: "OpenCode", description: "PR review and codebase triage" },
];

// ===== Icons =====

const ICON_CHECK: FC<{ size: number; color: string }> = ({ size, color }) => (
  <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke={color} strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
    <path d="m9 12 2 2 4-4" />
  </svg>
);

const ICON_STAR: FC<{ size: number; color: string }> = ({ size, color }) => (
  <svg width={size} height={size} viewBox="0 0 24 24" fill={color} stroke={color} strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
    <polygon points="12 2 15.09 8.26 22 9.27 17 14.14 18.18 21.02 12 17.77 5.82 21.02 7 14.14 2 9.27 8.91 8.26 12 2" />
  </svg>
);

const ICON_ARROW: FC<{ size: number; color: string }> = ({ size, color }) => (
  <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke={color} strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
    <path d="M5 12h14M12 5l7 7-7 7" />
  </svg>
);

// ===== Component =====

interface OnboardingWizardProps {
  onComplete: () => void;
}

const OnboardingWizard: FC<OnboardingWizardProps> = ({ onComplete }) => {
  const [step, setStep] = useState<1 | 2>(1);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [primary, setPrimary] = useState<string | null>(null);

  const setFavoriteAdapters = useAgentStore((s) => s.setFavoriteAdapters);
  const setPrimaryAdapter = useAgentStore((s) => s.setPrimaryAdapter);

  const toggleAdapter = useCallback((id: string) => {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(id)) {
        next.delete(id);
        if (primary === id) setPrimary(null);
      } else {
        next.add(id);
      }
      return next;
    });
  }, [primary]);

  const handleNext = useCallback(() => {
    if (step === 1 && selected.size >= 1) {
      // Auto-select primary if only 1 favorite
      if (selected.size === 1) {
        setPrimary([...selected][0]);
      }
      setStep(2);
    }
  }, [step, selected]);

  const handleFinish = useCallback(() => {
    const finalPrimary = primary ?? [...selected][0] ?? null;
    setFavoriteAdapters(selected);
    setPrimaryAdapter(finalPrimary);
    localStorage.setItem("conflux.onboarded.v1", "1");
    onComplete();
  }, [selected, primary, setFavoriteAdapters, setPrimaryAdapter, onComplete]);

  const canNext = step === 1 && selected.size >= 1;
  const canFinish = step === 2 && primary !== null;

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center"
      style={{
        background: "rgba(5,5,7,0.85)",
        backdropFilter: "blur(12px)",
        WebkitBackdropFilter: "blur(12px)",
      }}
    >
      <div
        className="flex flex-col overflow-hidden"
        style={{
          width: 520,
          maxHeight: "88vh",
          background: "rgba(255,255,255,0.04)",
          backdropFilter: "blur(24px)",
          WebkitBackdropFilter: "blur(24px)",
          border: "1px solid rgba(255,255,255,0.13)",
          borderRadius: 16,
          boxShadow: "0 24px 64px rgba(0,0,0,0.5), 0 0 0 1px rgba(255,255,255,0.04) inset",
        }}
      >
        {/* Header */}
        <div className="flex flex-col shrink-0" style={{ padding: "32px 36px 24px 36px", gap: 8 }}>
          <h1 style={{
            fontFamily: "'Fraunces Variable',Georgia,serif",
            fontSize: 28, fontWeight: 700, color: "#F2F2F2",
            letterSpacing: -0.3, margin: 0, lineHeight: 1.2,
          }}>
            {step === 1 ? "Welcome to Conflux" : "Choose your primary"}
          </h1>
          <p style={{
            fontFamily: "'Geist Sans',sans-serif",
            fontSize: 13, color: "#6B7280", margin: 0, lineHeight: 1.5,
          }}>
            {step === 1
              ? "Pick the agent frameworks you use. You can change this anytime in Settings."
              : "Select one framework as your default — the capsule and Send-to panel will use it."}
          </p>
          {/* Step indicator */}
          <div className="flex items-center" style={{ gap: 6, marginTop: 4 }}>
            <div style={{
              width: 24, height: 3, borderRadius: 2,
              background: "#B8D4E3",
            }} />
            <div style={{
              width: 24, height: 3, borderRadius: 2,
              background: step === 2 ? "#B8D4E3" : "rgba(255,255,255,0.12)",
              transition: "background 0.2s",
            }} />
          </div>
        </div>

        {/* Divider */}
        <div style={{ height: 1, background: "rgba(255,255,255,0.082)" }} />

        {/* Body */}
        <div className="flex-1 overflow-y-auto flex flex-col" style={{ padding: "20px 28px", gap: 10 }}>
          {step === 1 && ALL_ADAPTERS.map((a) => {
            const isSel = selected.has(a.id);
            return (
              <button
                key={a.id}
                onClick={() => toggleAdapter(a.id)}
                className="flex items-center w-full text-left transition-colors"
                style={{
                  padding: "16px 18px", gap: 14, borderRadius: 10,
                  background: isSel ? "rgba(184,212,227,0.08)" : "rgba(255,255,255,0.03)",
                  border: isSel ? "1px solid #B8D4E3" : "1px solid rgba(255,255,255,0.082)",
                }}
              >
                {/* Checkbox */}
                <div className="shrink-0 flex items-center justify-center" style={{
                  width: 22, height: 22, borderRadius: 6,
                  background: isSel ? "#B8D4E3" : "rgba(255,255,255,0.06)",
                  border: isSel ? "none" : "1px solid rgba(255,255,255,0.15)",
                  transition: "background 0.15s",
                }}>
                  {isSel && <ICON_CHECK size={14} color="#0A0F15" />}
                </div>
                <div className="flex-1 min-w-0 flex flex-col" style={{ gap: 3 }}>
                  <div className="flex items-center" style={{ gap: 8 }}>
                    <span style={{ fontFamily: "'Geist Sans',sans-serif", fontSize: 15, fontWeight: 600, color: "#F2F2F2" }}>
                      {a.name}
                    </span>
                    <span style={{
                      fontFamily: "'Geist Sans',sans-serif", fontSize: 10, fontWeight: 500,
                      padding: "2px 8px", borderRadius: 9999,
                      background: "rgba(255,255,255,0.06)", color: "#6B7280",
                    }}>
                      {a.vendor}
                    </span>
                  </div>
                  <span style={{ fontFamily: "'Geist Sans',sans-serif", fontSize: 11, color: "#6B7280" }}>
                    {a.description}
                  </span>
                </div>
              </button>
            );
          })}

          {step === 2 && [...selected].map((id) => {
            const a = ALL_ADAPTERS.find((x) => x.id === id)!;
            const isPrimary = primary === id;
            return (
              <button
                key={id}
                onClick={() => setPrimary(id)}
                className="flex items-center w-full text-left transition-colors"
                style={{
                  padding: "16px 18px", gap: 14, borderRadius: 10,
                  background: isPrimary ? "rgba(184,212,227,0.08)" : "rgba(255,255,255,0.03)",
                  border: isPrimary ? "1px solid #B8D4E3" : "1px solid rgba(255,255,255,0.082)",
                }}
              >
                {/* Radio */}
                <div className="shrink-0 flex items-center justify-center" style={{
                  width: 22, height: 22, borderRadius: 9999,
                  background: isPrimary ? "#B8D4E3" : "rgba(255,255,255,0.06)",
                  border: isPrimary ? "none" : "1px solid rgba(255,255,255,0.15)",
                }}>
                  {isPrimary && <ICON_STAR size={12} color="#0A0F15" />}
                </div>
                <div className="flex-1 min-w-0 flex flex-col" style={{ gap: 3 }}>
                  <span style={{ fontFamily: "'Geist Sans',sans-serif", fontSize: 15, fontWeight: 600, color: "#F2F2F2" }}>
                    {a.name}
                  </span>
                  <span style={{ fontFamily: "'Geist Sans',sans-serif", fontSize: 11, color: "#6B7280" }}>
                    {a.vendor} · {a.description}
                  </span>
                </div>
              </button>
            );
          })}
        </div>

        {/* Footer */}
        <div style={{ height: 1, background: "rgba(255,255,255,0.06)" }} />
        <div className="flex items-center shrink-0" style={{ padding: "18px 28px", gap: 12, justifyContent: "space-between" }}>
          {step === 2 ? (
            <button
              onClick={() => setStep(1)}
              style={{
                padding: "10px 18px", borderRadius: 9999,
                background: "rgba(255,255,255,0.04)",
                border: "1px solid rgba(255,255,255,0.082)",
                fontFamily: "'Geist Sans',sans-serif", fontSize: 13, fontWeight: 500,
                color: "#B8B3B0", cursor: "pointer",
              }}
            >
              Back
            </button>
          ) : (
            <span style={{ fontFamily: "'Geist Sans',sans-serif", fontSize: 11, color: "#6B728060" }}>
              {selected.size} selected
            </span>
          )}
          <button
            onClick={step === 1 ? handleNext : handleFinish}
            disabled={step === 1 ? !canNext : !canFinish}
            className="flex items-center transition-opacity"
            style={{
              padding: "10px 22px", gap: 8, borderRadius: 9999,
              background: "#B8D4E3",
              fontFamily: "'Geist Sans',sans-serif", fontSize: 13, fontWeight: 600,
              color: "#0A0F15",
              opacity: (step === 1 ? canNext : canFinish) ? 1 : 0.4,
              cursor: (step === 1 ? canNext : canFinish) ? "pointer" : "not-allowed",
            }}
          >
            <span>{step === 1 ? "Next" : "Get Started"}</span>
            <ICON_ARROW size={14} color="#0A0F15" />
          </button>
        </div>
      </div>
    </div>
  );
};

export { OnboardingWizard };
