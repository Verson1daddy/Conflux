// ===== CloseConfirmModal =====
// Shown when user clicks close without a saved preference.
// Offers "Minimize to system tray" or "Quit completely" with a "Remember" checkbox.

import { type FC, useState } from "react";

interface CloseConfirmModalProps {
  visible: boolean;
  onConfirm: (action: "tray" | "quit", remember: boolean) => void;
  onCancel: () => void;
}

const CloseConfirmModal: FC<CloseConfirmModalProps> = ({ visible, onConfirm, onCancel }) => {
  const [action, setAction] = useState<"tray" | "quit">("tray");
  const [remember, setRemember] = useState(false);

  if (!visible) return null;

  return (
    <div
      style={{
        position: "fixed",
        inset: 0,
        zIndex: 9999,
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        background: "rgba(0,0,0,0.6)",
        backdropFilter: "blur(8px)",
        WebkitBackdropFilter: "blur(8px)",
      }}
      onClick={onCancel}
    >
      <div
        style={{
          width: 360,
          background: "rgba(28,30,34,0.95)",
          borderRadius: 16,
          border: "1px solid rgba(255,255,255,0.10)",
          padding: "28px 28px 24px",
          boxShadow: "0 24px 80px rgba(0,0,0,0.5)",
        }}
        onClick={(e) => e.stopPropagation()}
      >
        {/* Title */}
        <h2
          style={{
            fontFamily: "'Fraunces Variable', serif",
            fontSize: 20,
            fontWeight: 600,
            color: "#F2F2F2",
            margin: "0 0 20px",
          }}
        >
          Close Conflux?
        </h2>

        {/* Radio options */}
        <div style={{ display: "flex", flexDirection: "column", gap: 12, marginBottom: 20 }}>
          <label
            style={{
              display: "flex",
              alignItems: "center",
              gap: 10,
              cursor: "pointer",
              padding: "10px 12px",
              borderRadius: 10,
              background: action === "tray" ? "rgba(184,212,227,0.08)" : "transparent",
              border: action === "tray" ? "1px solid rgba(184,212,227,0.20)" : "1px solid rgba(255,255,255,0.06)",
              transition: "all 150ms ease",
            }}
            onClick={() => setAction("tray")}
          >
            <span
              style={{
                width: 18,
                height: 18,
                borderRadius: 9999,
                border: action === "tray" ? "2px solid #B8D4E3" : "2px solid #6B7280",
                display: "flex",
                alignItems: "center",
                justifyContent: "center",
                flexShrink: 0,
              }}
            >
              {action === "tray" && (
                <span style={{ width: 8, height: 8, borderRadius: 9999, background: "#B8D4E3" }} />
              )}
            </span>
            <span
              style={{
                fontFamily: "'Geist Sans', sans-serif",
                fontSize: 14,
                color: action === "tray" ? "#F2F2F2" : "#B8B3B0",
                fontWeight: 500,
              }}
            >
              Minimize to system tray
            </span>
          </label>

          <label
            style={{
              display: "flex",
              alignItems: "center",
              gap: 10,
              cursor: "pointer",
              padding: "10px 12px",
              borderRadius: 10,
              background: action === "quit" ? "rgba(184,212,227,0.08)" : "transparent",
              border: action === "quit" ? "1px solid rgba(184,212,227,0.20)" : "1px solid rgba(255,255,255,0.06)",
              transition: "all 150ms ease",
            }}
            onClick={() => setAction("quit")}
          >
            <span
              style={{
                width: 18,
                height: 18,
                borderRadius: 9999,
                border: action === "quit" ? "2px solid #B8D4E3" : "2px solid #6B7280",
                display: "flex",
                alignItems: "center",
                justifyContent: "center",
                flexShrink: 0,
              }}
            >
              {action === "quit" && (
                <span style={{ width: 8, height: 8, borderRadius: 9999, background: "#B8D4E3" }} />
              )}
            </span>
            <span
              style={{
                fontFamily: "'Geist Sans', sans-serif",
                fontSize: 14,
                color: action === "quit" ? "#F2F2F2" : "#B8B3B0",
                fontWeight: 500,
              }}
            >
              Quit completely
            </span>
          </label>
        </div>

        {/* Remember checkbox */}
        <label
          style={{
            display: "flex",
            alignItems: "center",
            gap: 8,
            cursor: "pointer",
            marginBottom: 24,
          }}
          onClick={() => setRemember((v) => !v)}
        >
          <span
            style={{
              width: 16,
              height: 16,
              borderRadius: 4,
              border: remember ? "1.5px solid #B8D4E3" : "1.5px solid #6B7280",
              background: remember ? "rgba(184,212,227,0.15)" : "transparent",
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
              flexShrink: 0,
              transition: "all 150ms ease",
            }}
          >
            {remember && (
              <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="#B8D4E3" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round">
                <path d="M20 6 9 17l-5-5" />
              </svg>
            )}
          </span>
          <span
            style={{
              fontFamily: "'Geist Sans', sans-serif",
              fontSize: 13,
              color: "#6B7280",
            }}
          >
            Remember my choice
          </span>
        </label>

        {/* Action buttons */}
        <div style={{ display: "flex", justifyContent: "flex-end", gap: 10 }}>
          <button
            onClick={onCancel}
            style={{
              height: 36,
              padding: "0 18px",
              borderRadius: 9999,
              background: "transparent",
              border: "1px solid rgba(255,255,255,0.10)",
              color: "#B8B3B0",
              fontFamily: "'Geist Sans', sans-serif",
              fontSize: 13,
              fontWeight: 500,
              cursor: "pointer",
              transition: "all 150ms ease",
            }}
            onMouseEnter={(e) => { (e.currentTarget as HTMLElement).style.background = "rgba(255,255,255,0.05)"; }}
            onMouseLeave={(e) => { (e.currentTarget as HTMLElement).style.background = "transparent"; }}
          >
            Cancel
          </button>
          <button
            onClick={() => onConfirm(action, remember)}
            style={{
              height: 36,
              padding: "0 20px",
              borderRadius: 9999,
              background: "#B8D4E3",
              border: "none",
              color: "#0A0F15",
              fontFamily: "'Geist Sans', sans-serif",
              fontSize: 13,
              fontWeight: 600,
              cursor: "pointer",
              transition: "all 150ms ease",
            }}
            onMouseEnter={(e) => { (e.currentTarget as HTMLElement).style.background = "#c8e0ed"; }}
            onMouseLeave={(e) => { (e.currentTarget as HTMLElement).style.background = "#B8D4E3"; }}
          >
            Confirm
          </button>
        </div>
      </div>
    </div>
  );
};

export { CloseConfirmModal };
