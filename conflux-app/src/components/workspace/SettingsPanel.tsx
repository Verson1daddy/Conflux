// ===== SettingsPanel =====
// Two-column settings modal matching design/conflux.pen frame "Settings 面板" (PTDAa).
// C2-A1: All four tabs implemented — Permissions / Appearance / Adapters / About.
// Local state only — persistence wired in a later cycle.

import { type FC, useEffect, useState } from "react";
import { useAgentStore } from "@/stores/agentStore";
import { useIslandStore } from "@/stores/islandStore";
import type { IslandMode } from "@/types";

interface SettingsPanelProps {
  visible: boolean;
  onClose: () => void;
}

type SettingsTab = "frameworks" | "permissions" | "appearance" | "adapters" | "about";
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

const ICON_LAYERS: FC<{ size: number; color: string }> = ({ size, color }) => (
  <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke={color} strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
    <path d="m12.83 2.18a2 2 0 0 0-1.66 0L2.6 6.08a1 1 0 0 0 0 1.83l8.58 3.91a2 2 0 0 0 1.66 0l8.58-3.9a1 1 0 0 0 0-1.83Z" />
    <path d="m22 17.65-9.17 4.16a2 2 0 0 1-1.66 0L2 17.65" />
    <path d="m22 12.65-9.17 4.16a2 2 0 0 1-1.66 0L2 12.65" />
  </svg>
);

// ===== Additional icons for Appearance / About =====

const ICON_SUN: FC<{ size: number; color: string }> = ({ size, color }) => (
  <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke={color} strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
    <circle cx="12" cy="12" r="4" /><path d="M12 2v2M12 20v2M4.93 4.93l1.41 1.41M17.66 17.66l1.41 1.41M2 12h2M20 12h2M6.34 17.66l-1.41 1.41M19.07 4.93l-1.41 1.41" />
  </svg>
);

const ICON_MOON: FC<{ size: number; color: string }> = ({ size, color }) => (
  <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke={color} strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
    <path d="M12 3a6 6 0 0 0 9 9 9 9 0 1 1-9-9Z" />
  </svg>
);

const ICON_MONITOR: FC<{ size: number; color: string }> = ({ size, color }) => (
  <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke={color} strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
    <rect width="20" height="14" x="2" y="3" rx="2" /><line x1="8" x2="16" y1="21" y2="21" /><line x1="12" x2="12" y1="17" y2="21" />
  </svg>
);

const ICON_GITHUB: FC<{ size: number; color: string }> = ({ size, color }) => (
  <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke={color} strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
    <path d="M15 22v-4a4.8 4.8 0 0 0-1-3.5c3 0 6-2 6-5.5.08-1.25-.27-2.48-1-3.5.28-1.15.28-2.35 0-3.5 0 0-1 0-3 1.5-2.64-.5-5.36-.5-8 0C6 2 5 2 5 2c-.3 1.15-.3 2.35 0 3.5A5.403 5.403 0 0 0 4 9c0 3.5 3 5.5 6 5.5-.39.49-.68 1.05-.85 1.65-.17.6-.22 1.23-.15 1.85v4" />
    <path d="M9 18c-4.51 2-5-2-7-2" />
  </svg>
);

const ICON_HEART: FC<{ size: number; color: string }> = ({ size, color }) => (
  <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke={color} strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
    <path d="M19 14c1.49-1.46 3-3.21 3-5.5A5.5 5.5 0 0 0 16.5 3c-1.76 0-3 .5-4.5 2-1.5-1.5-2.74-2-4.5-2A5.5 5.5 0 0 0 2 8.5c0 2.3 1.5 4.05 3 5.5l7 7Z" />
  </svg>
);

// ===== Data =====

const NAV_ITEMS: NavItem[] = [
  { id: "frameworks", label: "Frameworks", icon: ICON_LAYERS },
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

// ===== Appearance data =====

type ThemeMode = "dark" | "light" | "system";
type FontSizeOption = 12 | 13 | 14 | 15;

interface AccentPreset {
  id: string;
  name: string;
  color: string;
}

const ACCENT_PRESETS: AccentPreset[] = [
  { id: "ice-blue",   name: "Ice Blue",   color: "#B8D4E3" },
  { id: "lavender",   name: "Lavender",   color: "#C8B5E3" },
  { id: "mint",       name: "Mint",       color: "#A8D8C0" },
  { id: "peach",      name: "Peach",      color: "#E3C0A8" },
  { id: "rose",       name: "Rose",       color: "#E3B8C8" },
  { id: "gold",       name: "Gold",       color: "#D4C88A" },
];

// ===== Adapters data =====

interface BuiltinAdapter {
  id: string;
  name: string;
  vendor: string;
  command: string;
  description: string;
}

const BUILTIN_ADAPTERS: BuiltinAdapter[] = [
  { id: "claude-code", name: "Claude Code", vendor: "Anthropic", command: "claude", description: "Flagship agent framework with sub-agent orchestration" },
  { id: "codex",       name: "Codex",       vendor: "OpenAI",    command: "codex",  description: "Code-focused reasoning and analysis" },
  { id: "aider",       name: "Aider",       vendor: "Paul Gauthier", command: "aider", description: "Git-aware pair programmer" },
  { id: "opencode",    name: "OpenCode",    vendor: "OpenCode",  command: "opencode", description: "PR review and codebase triage" },
];

// ===== About data =====

const VERSION = "0.1.0";
const TECH_STACK = [
  { label: "Runtime",  value: "Tauri 2.0 (Rust + WebView2)" },
  { label: "Frontend", value: "React 18 + TypeScript + Tailwind" },
  { label: "Terminal", value: "xterm.js 6 + WebGL renderer" },
  { label: "State",    value: "Zustand + SQLite" },
  { label: "Design",   value: "Pencil MCP" },
];

// ===== Component =====

const SettingsPanel: FC<SettingsPanelProps> = ({ visible, onClose }) => {
  const [activeTab, setActiveTab] = useState<SettingsTab>("frameworks");
  const [tier, setTier] = useState<PermissionTier>("smart");

  // Appearance state (local only — persistence in a later cycle)
  const [themeMode, setThemeMode] = useState<ThemeMode>("dark");
  const [fontSize, setFontSize] = useState<FontSizeOption>(13);
  const [accentColor, setAccentColor] = useState("ice-blue");

  // Frameworks tab state
  const favoriteAdapters = useAgentStore((s) => s.favoriteAdapters);
  const primaryAdapter = useAgentStore((s) => s.primaryAdapter);
  const setFavoriteAdaptersAction = useAgentStore((s) => s.setFavoriteAdapters);
  const setPrimaryAdapterAction = useAgentStore((s) => s.setPrimaryAdapter);

  // Island mode (Appearance tab)
  const islandMode = useIslandStore((s) => s.mode);
  const setIslandMode = useIslandStore((s) => s.setMode);

  // Adapters — read live instances from store to show "active" count
  const instances = useAgentStore((s) => s.instances);

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
        className="absolute inset-0 modal-scrim-enter"
        style={{ background: "rgba(0,0,0,0.53)", backdropFilter: "blur(6px)", WebkitBackdropFilter: "blur(6px)" }}
        onClick={onClose}
        aria-hidden="true"
      />

      <div
        className="relative flex flex-col overflow-hidden modal-panel-enter"
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
            {/* ===== Frameworks Tab ===== */}
            {activeTab === "frameworks" && (
              <>
                <h3 style={{ fontFamily: "'Fraunces Variable',Georgia,serif", fontSize: 20, fontWeight: 600, color: "#F2F2F2", letterSpacing: -0.2, margin: 0 }}>
                  Frameworks
                </h3>
                <p style={{ fontFamily: "'Geist Sans',sans-serif", fontSize: 12, color: "#6B7280", margin: 0, lineHeight: 1.5 }}>
                  Your favorite agent frameworks. The primary framework is used by the capsule brand name and Send-to panel default.
                </p>

                {/* Primary indicator */}
                {primaryAdapter && (
                  <div className="flex items-center" style={{
                    padding: "10px 14px", gap: 10, borderRadius: 8,
                    background: "rgba(184,212,227,0.06)",
                    border: "1px solid rgba(184,212,227,0.2)",
                  }}>
                    <span style={{ fontSize: 14 }}>⭐</span>
                    <span style={{ fontFamily: "'Geist Sans',sans-serif", fontSize: 12, color: "#B8D4E3", fontWeight: 500 }}>
                      Primary: {BUILTIN_ADAPTERS.find((a) => a.id === primaryAdapter)?.name ?? primaryAdapter}
                    </span>
                  </div>
                )}

                {/* Adapter list with favorite toggles */}
                <div className="flex flex-col" style={{ gap: 8 }}>
                  {BUILTIN_ADAPTERS.map((adapter) => {
                    const isFav = favoriteAdapters.has(adapter.id);
                    const isPrimary = primaryAdapter === adapter.id;
                    return (
                      <div
                        key={adapter.id}
                        className="flex items-center"
                        style={{
                          padding: "14px 16px", gap: 14, borderRadius: 8,
                          background: isFav ? "rgba(184,212,227,0.06)" : "rgba(255,255,255,0.03)",
                          border: isFav ? "1px solid rgba(184,212,227,0.25)" : "1px solid rgba(255,255,255,0.082)",
                        }}
                      >
                        {/* Favorite checkbox */}
                        <button
                          onClick={() => {
                            const next = new Set(favoriteAdapters);
                            if (next.has(adapter.id)) {
                              next.delete(adapter.id);
                              if (primaryAdapter === adapter.id) setPrimaryAdapterAction(null);
                            } else {
                              next.add(adapter.id);
                            }
                            setFavoriteAdaptersAction(next);
                          }}
                          className="shrink-0 flex items-center justify-center"
                          style={{
                            width: 20, height: 20, borderRadius: 5,
                            background: isFav ? "#B8D4E3" : "rgba(255,255,255,0.06)",
                            border: isFav ? "none" : "1px solid rgba(255,255,255,0.15)",
                            cursor: "pointer",
                          }}
                          title={isFav ? "Remove from favorites" : "Add to favorites"}
                        >
                          {isFav && <ICON_CHECK size={12} color="#0A0F15" />}
                        </button>

                        <div className="flex-1 min-w-0 flex flex-col" style={{ gap: 2 }}>
                          <div className="flex items-center" style={{ gap: 8 }}>
                            <span style={{ fontFamily: "'Geist Sans',sans-serif", fontSize: 14, fontWeight: 600, color: "#F2F2F2" }}>
                              {adapter.name}
                            </span>
                            {isPrimary && (
                              <span style={{
                                fontFamily: "'Geist Sans',sans-serif", fontSize: 9, fontWeight: 600,
                                padding: "2px 7px", borderRadius: 9999,
                                background: "rgba(184,212,227,0.15)", color: "#B8D4E3",
                              }}>
                                PRIMARY
                              </span>
                            )}
                          </div>
                          <span style={{ fontFamily: "'Geist Sans',sans-serif", fontSize: 11, color: "#6B7280" }}>
                            {adapter.vendor} · {adapter.description}
                          </span>
                        </div>

                        {/* Set as primary button (only for favorites) */}
                        {isFav && !isPrimary && (
                          <button
                            onClick={() => setPrimaryAdapterAction(adapter.id)}
                            style={{
                              padding: "4px 10px", borderRadius: 9999,
                              background: "rgba(255,255,255,0.04)",
                              border: "1px solid rgba(255,255,255,0.1)",
                              fontFamily: "'Geist Sans',sans-serif", fontSize: 10,
                              color: "#B8B3B0", cursor: "pointer",
                            }}
                          >
                            Set primary
                          </button>
                        )}
                      </div>
                    );
                  })}
                </div>
              </>
            )}

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

            {/* ===== Appearance Tab ===== */}
            {activeTab === "appearance" && (
              <>
                <h3 style={{ fontFamily: "'Fraunces Variable',Georgia,serif", fontSize: 20, fontWeight: 600, color: "#F2F2F2", letterSpacing: -0.2, margin: 0 }}>
                  Appearance
                </h3>
                <p style={{ fontFamily: "'Geist Sans',sans-serif", fontSize: 12, color: "#6B7280", margin: 0, lineHeight: 1.5 }}>
                  Customize the look and feel of your workspace.
                </p>

                {/* Theme selector */}
                <div className="flex flex-col" style={{ gap: 8 }}>
                  <span style={{ fontFamily: "'Geist Sans',sans-serif", fontSize: 10, fontWeight: 600, letterSpacing: 1.5, color: "#6B7280", textTransform: "uppercase" as const }}>
                    Theme
                  </span>
                  <div className="flex" style={{ gap: 8 }}>
                    {([
                      { mode: "dark" as ThemeMode, label: "Dark", icon: ICON_MOON },
                      { mode: "light" as ThemeMode, label: "Light", icon: ICON_SUN },
                      { mode: "system" as ThemeMode, label: "System", icon: ICON_MONITOR },
                    ]).map(({ mode, label, icon: Icon }) => {
                      const sel = themeMode === mode;
                      const disabled = mode !== "dark";
                      return (
                        <button
                          key={mode}
                          onClick={() => !disabled && setThemeMode(mode)}
                          className="flex items-center justify-center flex-1"
                          style={{
                            height: 40, gap: 6, borderRadius: 8,
                            background: sel ? "rgba(255,255,255,0.07)" : "rgba(255,255,255,0.03)",
                            border: sel ? "1px solid #B8D4E3" : "1px solid rgba(255,255,255,0.082)",
                            opacity: disabled ? 0.35 : 1,
                            cursor: disabled ? "not-allowed" : "pointer",
                          }}
                          title={disabled ? "Coming soon" : label}
                        >
                          <Icon size={14} color={sel ? "#B8D4E3" : "#6B7280"} />
                          <span style={{ fontFamily: "'Geist Sans',sans-serif", fontSize: 12, fontWeight: sel ? 600 : 400, color: sel ? "#F2F2F2" : "#B8B3B0" }}>
                            {label}
                          </span>
                        </button>
                      );
                    })}
                  </div>
                </div>

                {/* Font size */}
                <div className="flex flex-col" style={{ gap: 8 }}>
                  <span style={{ fontFamily: "'Geist Sans',sans-serif", fontSize: 10, fontWeight: 600, letterSpacing: 1.5, color: "#6B7280", textTransform: "uppercase" as const }}>
                    Terminal Font Size
                  </span>
                  <div className="flex" style={{ gap: 6 }}>
                    {([12, 13, 14, 15] as FontSizeOption[]).map((sz) => {
                      const sel = fontSize === sz;
                      return (
                        <button
                          key={sz}
                          onClick={() => setFontSize(sz)}
                          className="flex items-center justify-center"
                          style={{
                            width: 44, height: 36, borderRadius: 8,
                            background: sel ? "rgba(255,255,255,0.07)" : "rgba(255,255,255,0.03)",
                            border: sel ? "1px solid #B8D4E3" : "1px solid rgba(255,255,255,0.082)",
                            fontFamily: "'JetBrains Mono Variable',monospace", fontSize: 13, fontWeight: sel ? 600 : 400,
                            color: sel ? "#F2F2F2" : "#B8B3B0",
                          }}
                        >
                          {sz}
                        </button>
                      );
                    })}
                  </div>
                </div>

                {/* Accent color */}
                <div className="flex flex-col" style={{ gap: 8 }}>
                  <span style={{ fontFamily: "'Geist Sans',sans-serif", fontSize: 10, fontWeight: 600, letterSpacing: 1.5, color: "#6B7280", textTransform: "uppercase" as const }}>
                    Accent Color
                  </span>
                  <div className="flex flex-wrap" style={{ gap: 10 }}>
                    {ACCENT_PRESETS.map((preset) => {
                      const sel = accentColor === preset.id;
                      return (
                        <button
                          key={preset.id}
                          onClick={() => setAccentColor(preset.id)}
                          className="flex flex-col items-center"
                          style={{ gap: 4, cursor: "pointer", background: "none", border: "none", padding: 0 }}
                          title={preset.name}
                        >
                          <div
                            style={{
                              width: 32, height: 32, borderRadius: 9999,
                              background: preset.color,
                              border: sel ? "2px solid #F2F2F2" : "2px solid transparent",
                              boxShadow: sel ? `0 0 0 2px ${preset.color}40` : "none",
                              transition: "box-shadow 0.15s, border-color 0.15s",
                            }}
                          />
                          <span style={{ fontFamily: "'Geist Sans',sans-serif", fontSize: 9, color: sel ? "#F2F2F2" : "#6B7280" }}>
                            {preset.name}
                          </span>
                        </button>
                      );
                    })}
                  </div>
                </div>

                {/* C2-A5 Island mode selector */}
                <div className="flex flex-col" style={{ gap: 8 }}>
                  <span style={{ fontFamily: "'Geist Sans',sans-serif", fontSize: 10, fontWeight: 600, letterSpacing: 1.5, color: "#6B7280", textTransform: "uppercase" as const }}>
                    Island Mode
                  </span>
                  <div className="flex" style={{ gap: 8 }}>
                    {([
                      { mode: "top_island" as IslandMode, label: "Capsule", desc: "Top bar capsule" },
                      { mode: "float_ball" as IslandMode, label: "Float Ball", desc: "Draggable overlay" },
                      { mode: "sidebar" as IslandMode, label: "Sidebar", desc: "Right panel" },
                    ]).map(({ mode, label, desc }) => {
                      const sel = islandMode === mode;
                      return (
                        <button
                          key={mode}
                          onClick={() => setIslandMode(mode)}
                          className="flex flex-col flex-1 items-center justify-center"
                          style={{
                            height: 56, gap: 3, borderRadius: 8,
                            background: sel ? "rgba(255,255,255,0.07)" : "rgba(255,255,255,0.03)",
                            border: sel ? "1px solid #B8D4E3" : "1px solid rgba(255,255,255,0.082)",
                            cursor: "pointer",
                          }}
                          title={desc}
                        >
                          <span style={{ fontFamily: "'Geist Sans',sans-serif", fontSize: 12, fontWeight: sel ? 600 : 400, color: sel ? "#F2F2F2" : "#B8B3B0" }}>
                            {label}
                          </span>
                          <span style={{ fontFamily: "'Geist Sans',sans-serif", fontSize: 9, color: "#6B7280" }}>
                            {desc}
                          </span>
                        </button>
                      );
                    })}
                  </div>
                </div>

                <p style={{ fontFamily: "'Geist Sans',sans-serif", fontSize: 11, color: "#6B7280", margin: 0, fontStyle: "italic" }}>
                  Theme & accent changes are preview-only — persistence coming in the next cycle.
                </p>
              </>
            )}

            {/* ===== Adapters Tab ===== */}
            {activeTab === "adapters" && (
              <>
                <h3 style={{ fontFamily: "'Fraunces Variable',Georgia,serif", fontSize: 20, fontWeight: 600, color: "#F2F2F2", letterSpacing: -0.2, margin: 0 }}>
                  Adapters
                </h3>
                <p style={{ fontFamily: "'Geist Sans',sans-serif", fontSize: 12, color: "#6B7280", margin: 0, lineHeight: 1.5 }}>
                  Agent frameworks registered in Conflux. Built-in adapters detect CLI binaries on your PATH.
                </p>

                <div className="flex flex-col" style={{ gap: 8 }}>
                  {BUILTIN_ADAPTERS.map((adapter) => {
                    const activeCount = Array.from(instances.values()).filter(
                      (inst) => inst.adapter_id === adapter.id
                    ).length;
                    return (
                      <div
                        key={adapter.id}
                        className="flex items-center"
                        style={{
                          padding: "14px 16px", gap: 14, borderRadius: 8,
                          background: "rgba(255,255,255,0.04)",
                          border: "1px solid rgba(255,255,255,0.082)",
                        }}
                      >
                        <div
                          className="shrink-0 flex items-center justify-center"
                          style={{
                            width: 36, height: 36, borderRadius: 8,
                            background: "rgba(255,255,255,0.055)",
                          }}
                        >
                          <ICON_PLUG size={18} color="#B8B3B0" />
                        </div>
                        <div className="flex-1 min-w-0 flex flex-col" style={{ gap: 3 }}>
                          <div className="flex items-center" style={{ gap: 8 }}>
                            <span style={{ fontFamily: "'Geist Sans',sans-serif", fontSize: 14, fontWeight: 600, color: "#F2F2F2" }}>
                              {adapter.name}
                            </span>
                            <span style={{
                              fontFamily: "'Geist Sans',sans-serif", fontSize: 10, fontWeight: 500,
                              padding: "2px 8px", borderRadius: 9999,
                              background: "rgba(184,212,227,0.12)", color: "#B8D4E3",
                            }}>
                              built-in
                            </span>
                          </div>
                          <span style={{ fontFamily: "'Geist Sans',sans-serif", fontSize: 11, color: "#6B7280" }}>
                            {adapter.vendor} · <span style={{ fontFamily: "'JetBrains Mono Variable',monospace", fontSize: 10 }}>{adapter.command}</span>
                          </span>
                        </div>
                        {activeCount > 0 && (
                          <span style={{
                            fontFamily: "'Geist Sans',sans-serif", fontSize: 10, fontWeight: 500,
                            padding: "3px 8px", borderRadius: 9999,
                            background: "rgba(52,199,89,0.12)", color: "#34C759",
                          }}>
                            {activeCount} active
                          </span>
                        )}
                      </div>
                    );
                  })}
                </div>

                <div style={{ height: 1, background: "rgba(255,255,255,0.06)" }} />

                <button
                  className="flex items-center justify-center"
                  style={{
                    height: 40, gap: 8, borderRadius: 8,
                    background: "rgba(255,255,255,0.04)",
                    border: "1px dashed rgba(255,255,255,0.15)",
                    fontFamily: "'Geist Sans',sans-serif", fontSize: 12, fontWeight: 500,
                    color: "#6B7280", cursor: "pointer",
                  }}
                  title="Register a custom adapter via TOML config (coming soon)"
                >
                  + Register Custom Adapter
                </button>

                <p style={{ fontFamily: "'Geist Sans',sans-serif", fontSize: 11, color: "#6B7280", margin: 0, fontStyle: "italic" }}>
                  Custom adapter registration from TOML config — coming in the next cycle.
                </p>
              </>
            )}

            {/* ===== About Tab ===== */}
            {activeTab === "about" && (
              <>
                <div className="flex items-center" style={{ gap: 14 }}>
                  <div className="flex flex-col" style={{ gap: 4 }}>
                    <h3 style={{ fontFamily: "'Fraunces Variable',Georgia,serif", fontSize: 24, fontWeight: 700, color: "#F2F2F2", letterSpacing: -0.3, margin: 0 }}>
                      Conflux
                    </h3>
                    <span style={{ fontFamily: "'Geist Sans',sans-serif", fontSize: 12, color: "#6B7280" }}>
                      汇流 · Multi-Agent CLI Workspace
                    </span>
                  </div>
                  <div className="flex-1" />
                  <span style={{
                    fontFamily: "'JetBrains Mono Variable',monospace", fontSize: 11, fontWeight: 500,
                    padding: "4px 10px", borderRadius: 9999,
                    background: "rgba(184,212,227,0.12)", color: "#B8D4E3",
                  }}>
                    v{VERSION}
                  </span>
                </div>

                <p style={{ fontFamily: "'Geist Sans',sans-serif", fontSize: 12, color: "#B8B3B0", margin: 0, lineHeight: 1.6 }}>
                  Conflux unifies multiple agent CLI frameworks into one visual workspace with a Dynamic Island control interface. Zero extra API cost — cross-agent communication via stdin injection.
                </p>

                <div style={{ height: 1, background: "rgba(255,255,255,0.06)" }} />

                {/* Tech stack */}
                <div className="flex flex-col" style={{ gap: 8 }}>
                  <span style={{ fontFamily: "'Geist Sans',sans-serif", fontSize: 10, fontWeight: 600, letterSpacing: 1.5, color: "#6B7280", textTransform: "uppercase" as const }}>
                    Tech Stack
                  </span>
                  <div className="flex flex-col" style={{ gap: 6 }}>
                    {TECH_STACK.map((row) => (
                      <div key={row.label} className="flex" style={{ gap: 8 }}>
                        <span style={{ fontFamily: "'Geist Sans',sans-serif", fontSize: 11, fontWeight: 600, color: "#6B7280", width: 70, flexShrink: 0 }}>
                          {row.label}
                        </span>
                        <span style={{ fontFamily: "'Geist Sans',sans-serif", fontSize: 11, color: "#B8B3B0" }}>
                          {row.value}
                        </span>
                      </div>
                    ))}
                  </div>
                </div>

                <div style={{ height: 1, background: "rgba(255,255,255,0.06)" }} />

                {/* Links */}
                <div className="flex" style={{ gap: 12 }}>
                  <div
                    className="flex items-center"
                    style={{
                      gap: 6, padding: "8px 14px", borderRadius: 8,
                      background: "rgba(255,255,255,0.04)",
                      border: "1px solid rgba(255,255,255,0.082)",
                      cursor: "pointer",
                    }}
                  >
                    <ICON_GITHUB size={14} color="#B8B3B0" />
                    <span style={{ fontFamily: "'Geist Sans',sans-serif", fontSize: 12, color: "#B8B3B0" }}>
                      GitHub
                    </span>
                  </div>
                  <div
                    className="flex items-center"
                    style={{
                      gap: 6, padding: "8px 14px", borderRadius: 8,
                      background: "rgba(255,255,255,0.04)",
                      border: "1px solid rgba(255,255,255,0.082)",
                      cursor: "pointer",
                    }}
                  >
                    <ICON_HEART size={14} color="#B8B3B0" />
                    <span style={{ fontFamily: "'Geist Sans',sans-serif", fontSize: 12, color: "#B8B3B0" }}>
                      Sponsor
                    </span>
                  </div>
                </div>

                <p style={{ fontFamily: "'Geist Sans',sans-serif", fontSize: 10, color: "#6B728080", margin: 0, lineHeight: 1.5 }}>
                  MIT License · Built with Claude Opus 4.6 + Pencil MCP
                </p>
              </>
            )}
          </div>
        </div>
      </div>
    </div>
  );
};

export { SettingsPanel };
