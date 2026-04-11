// ===== SettingsPanel =====
// Two-column settings modal. Permissions tab is functional preview (local state);
// other tabs are placeholder for the upcoming cycle.
// Matches design/conflux.pen frame "Settings 面板" (PTDAa).

import { type FC, useEffect, useState } from "react";

interface SettingsPanelProps {
  visible: boolean;
  onClose: () => void;
}

type SettingsTab = "permissions" | "appearance" | "adapters" | "about";
type PermissionTier = "manual" | "smart" | "autonomous";

interface NavItem {
  id: SettingsTab;
  label: string;
  icon: FC<{ size: number; color: string }>;
}

interface TierCard {
  id: PermissionTier;
  name: string;
  description: string;
  icon: FC<{ size: number; color: string }>;
}

// ===== Icons =====

const ICON_SHIELD: FC<{ size: number; color: string }> = ({ size, color }) => (
  <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke={color} strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
    <path d="M20 13c0 5-3.5 7.5-7.66 8.95a1 1 0 0 1-.67-.01C7.5 20.5 4 18 4 13V6a1 1 0 0 1 1-1c2 0 4.5-1.2 6.24-2.72a1.17 1.17 0 0 1 1.52 0C14.51 3.81 17 5 19 5a1 1 0 0 1 1 1z" />
    <path d="m9 12 2 2 4-4" />
  </svg>
);

const ICON_PALETTE: FC<{ size: number; color: string }> = ({ size, color }) => (
  <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke={color} strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
    <circle cx="13.5" cy="6.5" r=".5" fill={color} /><circle cx="17.5" cy="10.5" r=".5" fill={color} />
    <circle cx="8.5" cy="7.5" r=".5" fill={color} /><circle cx="6.5" cy="12.5" r=".5" fill={color} />
    <path d="M12 2C6.5 2 2 6.5 2 12s4.5 10 10 10c.926 0 1.648-.746 1.648-1.688 0-.437-.18-.835-.437-1.125-.29-.289-.438-.652-.438-1.125a1.64 1.64 0 0 1 1.668-1.668h1.996c3.051 0 5.555-2.503 5.555-5.554C21.965 6.012 17.461 2 12 2z" />
  </svg>
);

const ICON_PLUG: FC<{ size: number; color: string }> = ({ size, color }) => (
  <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke={color} strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
    <path d="M12 22v-5" /><path d="M9 8V2" /><path d="M15 8V2" /><path d="M18 8v5a4 4 0 0 1-4 4h-4a4 4 0 0 1-4-4V8Z" />
  </svg>
);

const ICON_INFO: FC<{ size: number; color: string }> = ({ size, color }) => (
  <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke={color} strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
    <circle cx="12" cy="12" r="10" /><path d="M12 16v-4M12 8h.01" />
  </svg>
);

const ICON_HAND: FC<{ size: number; color: string }> = ({ size, color }) => (
  <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke={color} strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
    <path d="M18 11V6a2 2 0 0 0-2-2a2 2 0 0 0-2 2" /><path d="M14 10V4a2 2 0 0 0-2-2a2 2 0 0 0-2 2v2" />
    <path d="M10 10.5V6a2 2 0 0 0-2-2a2 2 0 0 0-2 2v8" />
    <path d="M18 8a2 2 0 1 1 4 0v6a8 8 0 0 1-8 8h-2c-2.8 0-4.5-.86-5.99-2.34l-3.6-3.6a2 2 0 0 1 2.83-2.82L7 15" />
  </svg>
);

const ICON_SPARKLES: FC<{ size: number; color: string }> = ({ size, color }) => (
  <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke={color} strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
    <path d="m12 3-1.9 5.8a2 2 0 0 1-1.287 1.288L3 12l5.8 1.9a2 2 0 0 1 1.288 1.287L12 21l1.9-5.8a2 2 0 0 1 1.287-1.288L21 12l-5.8-1.9a2 2 0 0 1-1.288-1.287Z" />
    <path d="M5 3v4M3 5h4M19 17v4M17 19h4" />
  </svg>
);

const ICON_ZAP: FC<{ size: number; color: string }> = ({ size, color }) => (
  <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke={color} strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
    <path d="M4 14a1 1 0 0 1-.78-1.63l9.9-10.2a.5.5 0 0 1 .86.46l-1.92 6.02A1 1 0 0 0 13 10h7a1 1 0 0 1 .78 1.63l-9.9 10.2a.5.5 0 0 1-.86-.46l1.92-6.02A1 1 0 0 0 11 14z" />
  </svg>
);

const ICON_CHECK: FC<{ size: number; color: string }> = ({ size, color }) => (
  <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke={color} strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
    <circle cx="12" cy="12" r="10" /><path d="m9 12 2 2 4-4" />
  </svg>
);

const ICON_X: FC<{ size: number; color: string }> = ({ size, color }) => (
  <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke={color} strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
    <path d="M18 6 6 18M6 6l12 12" />
  </svg>
);

// ===== Data =====

const NAV_ITEMS: NavItem[] = [
  { id: "permissions", label: "Permissions", icon: ICON_SHIELD },
  { id: "appearance", label: "Appearance", icon: ICON_PALETTE },
  { id: "adapters", label: "Adapters", icon: ICON_PLUG },
  { id: "about", label: "About", icon: ICON_INFO },
];

const TIER_CARDS: TierCard[] = [
  { id: "manual", name: "Manual", description: "Confirm every tool call. Maximum oversight, slowest flow.", icon: ICON_HAND },
  { id: "smart", name: "Smart", description: "Auto-approve safe ops. Prompts only on destructive actions.", icon: ICON_SPARKLES },
  { id: "autonomous", name: "Autonomous", description: "Hands-off execution. Agent owns the full loop until it calls done.", icon: ICON_ZAP },
];

// ===== Component =====

const SettingsPanel: FC<SettingsPanelProps> = ({ visible, onClose }) => {
  const [activeTab, setActiveTab] = useState<SettingsTab>("permissions");
  const [tier, setTier] = useState<PermissionTier>("smart");

  useEffect(() => {
    if (!visible) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [visible, onClose]);

  if (!visible) return null;

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center"
      role="dialog"
      aria-modal="true"
      aria-label="Settings"
    >
      <div
        className="absolute inset-0"
        style={{ background: "rgba(0,0,0,0.53)", backdropFilter: "blur(6px)", WebkitBackdropFilter: "blur(6px)" }}
        onClick={onClose}
        aria-hidden="true"
      />

      <div
        className="relative flex flex-col overflow-hidden"
        style={{
          width: 720,
          height: 600,
          maxHeight: "92vh",
          background: "rgba(255,255,255,0.04)",
          backdropFilter: "blur(24px)",
          WebkitBackdropFilter: "blur(24px)",
          border: "1px solid rgba(255,255,255,0.13)",
          borderRadius: 12,
          boxShadow: "0 16px 48px rgba(0,0,0,0.4), 0 0 0 1px rgba(255,255,255,0.04) inset",
        }}
      >
        {/* Header */}
        <div className="flex items-center shrink-0" style={{ padding: "20px 28px", gap: 12 }}>
          <h2
            style={{
              fontFamily: "'Fraunces Variable', Georgia, serif",
              fontSize: 22,
              fontWeight: 600,
              color: "#F2F2F2",
              letterSpacing: -0.2,
              margin: 0,
            }}
          >
            Settings
          </h2>
          <div className="flex-1" />
          <button
            onClick={onClose}
            className="shrink-0 flex items-center justify-center"
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

        {/* Main row */}
        <div className="flex-1 flex min-h-0">
          {/* Sidebar */}
          <nav
            className="flex flex-col shrink-0"
            style={{ width: 220, padding: "18px 14px", gap: 4, background: "rgba(0,0,0,0.125)" }}
          >
            {NAV_ITEMS.map((item) => {
              const isActive = activeTab === item.id;
              const IconComp = item.icon;
              return (
                <button
                  key={item.id}
                  onClick={() => setActiveTab(item.id)}
                  className="flex items-center text-left"
                  style={{
                    padding: "10px 12px",
                    gap: 10,
                    borderRadius: 8,
                    background: isActive ? "#1C1C1E" : "transparent",
                    border: isActive ? "1px solid #B8D4E3" : "1px solid transparent",
                  }}
                >
                  <IconComp size={15} color={isActive ? "#B8D4E3" : "#6B7280"} />
                  <span
                    style={{
                      fontFamily: "'Geist Sans',sans-serif",
                      fontSize: 13,
                      fontWeight: isActive ? 600 : 500,
                      color: isActive ? "#F2F2F2" : "#B8B3B0",
                    }}
                  >
                    {item.label}
                  </span>
                </button>
              );
            })}
          </nav>

          {/* Content */}
          <div className="flex-1 min-w-0 overflow-y-auto flex flex-col" style={{ padding: "26px 32px", gap: 20 }}>
            {activeTab === "permissions" && (
              <>
                <h3
                  style={{
                    fontFamily: "'Fraunces Variable', Georgia, serif",
                    fontSize: 20,
                    fontWeight: 600,
                    color: "#F2F2F2",
                    letterSpacing: -0.2,
                    margin: 0,
                  }}
                >
                  Agent Permissions
                </h3>
                <p
                  style={{
                    fontFamily: "'Geist Sans',sans-serif",
                    fontSize: 12,
                    color: "#6B7280",
                    margin: 0,
                    lineHeight: 1.5,
                  }}
                >
                  Choose how much autonomy your agents have. You can override per-session from the sidebar.
                </p>

                <div className="flex flex-col" style={{ gap: 10 }}>
                  {TIER_CARDS.map((card) => {
                    const isSelected = tier === card.id;
                    const IconComp = card.icon;
                    return (
                      <button
                        key={card.id}
                        onClick={() => setTier(card.id)}
                        className="flex items-center w-full text-left"
                        style={{
                          padding: "16px 18px",
                          gap: 14,
                          borderRadius: 8,
                          background: isSelected ? "rgba(255,255,255,0.07)" : "rgba(255,255,255,0.04)",
                          border: isSelected ? "1px solid #B8D4E3" : "1px solid rgba(255,255,255,0.082)",
                        }}
                      >
                        <IconComp size={22} color={isSelected ? "#B8D4E3" : "#B8B3B0"} />
                        <div className="flex-1 min-w-0 flex flex-col" style={{ gap: 4 }}>
                          <span
                            style={{
                              fontFamily: "'Geist Sans',sans-serif",
                              fontSize: 14,
                              fontWeight: 600,
                              color: "#F2F2F2",
                            }}
                          >
                            {card.name}
                          </span>
                          <span
                            style={{
                              fontFamily: "'Geist Sans',sans-serif",
                              fontSize: 11,
                              color: "#6B7280",
                            }}
                          >
                            {card.description}
                          </span>
                        </div>
                        {isSelected && <ICON_CHECK size={18} color="#B8D4E3" />}
                      </button>
                    );
                  })}
                </div>

                <p
                  style={{
                    fontFamily: "'Geist Sans',sans-serif",
                    fontSize: 11,
                    color: "#6B7280",
                    margin: 0,
                    fontStyle: "italic",
                  }}
                >
                  Persistence is wired in the next cycle — changes are preview-only for now.
                </p>
              </>
            )}

            {activeTab !== "permissions" && (
              <div className="flex-1 flex items-center justify-center flex-col" style={{ gap: 10, minHeight: 300 }}>
                <h3
                  style={{
                    fontFamily: "'Fraunces Variable', Georgia, serif",
                    fontSize: 20,
                    fontWeight: 600,
                    color: "#F2F2F2",
                    margin: 0,
                  }}
                >
                  Coming in the next cycle
                </h3>
                <p
                  style={{
                    fontFamily: "'Geist Sans',sans-serif",
                    fontSize: 12,
                    color: "#6B7280",
                    margin: 0,
                    maxWidth: 340,
                    textAlign: "center",
                    lineHeight: 1.5,
                  }}
                >
                  This panel is reserved for the upcoming {activeTab} settings.
                </p>
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
};

export { SettingsPanel };
