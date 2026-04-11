// ===== SearchPalette =====
// Command palette overlay — placeholder empty state for the upcoming cycle.
// Matches design/conflux.pen frame "Search 命令面板" (GY7OQ).

import { type FC, useEffect } from "react";

interface SearchPaletteProps {
  visible: boolean;
  onClose: () => void;
}

const ICON_SEARCH: FC<{ size: number; color: string }> = ({ size, color }) => (
  <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke={color} strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
    <circle cx="11" cy="11" r="8" /><path d="m21 21-4.3-4.3" />
  </svg>
);

const ICON_COMMAND: FC<{ size: number; color: string }> = ({ size, color }) => (
  <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke={color} strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
    <path d="M15 6v12a3 3 0 1 0 3-3H6a3 3 0 1 0 3 3V6a3 3 0 1 0-3 3h12a3 3 0 1 0-3-3" />
  </svg>
);

const SearchPalette: FC<SearchPaletteProps> = ({ visible, onClose }) => {
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
      className="fixed inset-0 z-50 flex items-start justify-center"
      role="dialog"
      aria-modal="true"
      aria-label="Search"
      style={{ paddingTop: "14vh" }}
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
          width: 560,
          height: 380,
          background: "rgba(255,255,255,0.04)",
          backdropFilter: "blur(24px)",
          WebkitBackdropFilter: "blur(24px)",
          border: "1px solid rgba(255,255,255,0.13)",
          borderRadius: 12,
          boxShadow: "0 16px 48px rgba(0,0,0,0.4), 0 0 0 1px rgba(255,255,255,0.04) inset",
        }}
      >
        {/* Search row */}
        <div className="flex items-center shrink-0" style={{ padding: "20px 22px", gap: 14 }}>
          <ICON_SEARCH size={18} color="#6B7280" />
          <span
            className="flex-1 min-w-0 truncate"
            style={{
              fontFamily: "'Geist Sans',sans-serif",
              fontSize: 15,
              color: "#6B7280",
            }}
          >
            Search agents, sessions, files…
          </span>
          <span
            className="shrink-0 flex items-center"
            style={{
              padding: "3px 8px",
              borderRadius: 4,
              background: "rgba(255,255,255,0.07)",
              border: "1px solid rgba(255,255,255,0.082)",
              fontFamily: "'JetBrains Mono Variable',monospace",
              fontSize: 10,
              fontWeight: 500,
              color: "#6B7280",
            }}
          >
            Esc
          </span>
        </div>

        {/* Divider */}
        <div style={{ height: 1, background: "rgba(255,255,255,0.082)" }} />

        {/* Empty state */}
        <div className="flex-1 flex flex-col items-center justify-center" style={{ padding: "28px 32px", gap: 14 }}>
          <div
            className="flex items-center justify-center"
            style={{
              width: 64,
              height: 64,
              borderRadius: 9999,
              background: "rgba(255,255,255,0.07)",
              border: "1px solid rgba(255,255,255,0.082)",
            }}
          >
            <ICON_COMMAND size={28} color="#B8D4E3" />
          </div>
          <h3
            style={{
              fontFamily: "'Fraunces Variable', Georgia, serif",
              fontSize: 20,
              fontWeight: 600,
              color: "#F2F2F2",
              margin: 0,
            }}
          >
            Command palette is on deck
          </h3>
          <p
            style={{
              fontFamily: "'Geist Sans',sans-serif",
              fontSize: 12,
              color: "#6B7280",
              margin: 0,
              maxWidth: 360,
              textAlign: "center",
              lineHeight: 1.5,
            }}
          >
            A unified search across agents, sessions, and files. Coming in the next cycle.
          </p>
        </div>
      </div>
    </div>
  );
};

export { SearchPalette };
