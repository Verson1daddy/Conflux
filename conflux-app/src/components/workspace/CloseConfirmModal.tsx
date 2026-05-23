import { type FC, useEffect, useState } from "react";
import type { CloseAction } from "@/types";

interface CloseConfirmModalProps {
  visible: boolean;
  onConfirm: (action: CloseAction, remember: boolean) => void;
  onCancel: () => void;
}

const OPTIONS: Array<{ value: CloseAction; label: string; description: string }> = [
  {
    value: "quit",
    label: "Quit completely",
    description: "Exit the Conflux process and remove the tray icon.",
  },
  {
    value: "top_island",
    label: "Dynamic Island",
    description: "Hide the workspace and keep only the top capsule available.",
  },
  {
    value: "sidebar",
    label: "Sidebar",
    description: "Hide the workspace and keep only the right-edge reveal sidebar available.",
  },
];

const CloseConfirmModal: FC<CloseConfirmModalProps> = ({
  visible,
  onConfirm,
  onCancel,
}) => {
  const [action, setAction] = useState<CloseAction>("quit");
  const [remember, setRemember] = useState(false);

  useEffect(() => {
    if (!visible) {
      setAction("quit");
      setRemember(false);
    }
  }, [visible]);

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
          width: 420,
          background: "rgba(28,30,34,0.95)",
          borderRadius: 16,
          border: "1px solid rgba(255,255,255,0.10)",
          padding: "28px 28px 24px",
          boxShadow: "0 24px 80px rgba(0,0,0,0.5)",
        }}
        onClick={(e) => e.stopPropagation()}
      >
        <h2
          style={{
            fontFamily: "'Fraunces Variable', serif",
            fontSize: 20,
            fontWeight: 600,
            color: "#F2F2F2",
            margin: "0 0 12px",
          }}
        >
          Close Conflux?
        </h2>

        <p
          style={{
            margin: "0 0 20px",
            color: "#6B7280",
            fontFamily: "'Geist Sans', sans-serif",
            fontSize: 13,
            lineHeight: 1.5,
          }}
        >
          Choose whether to quit the app or switch the workspace into one compact mode.
        </p>

        <div style={{ display: "flex", flexDirection: "column", gap: 10, marginBottom: 20 }}>
          {OPTIONS.map((option) => {
            const selected = action === option.value;
            return (
              <label
                key={option.value}
                style={{
                  display: "flex",
                  alignItems: "flex-start",
                  gap: 12,
                  cursor: "pointer",
                  padding: "12px 14px",
                  borderRadius: 10,
                  background: selected ? "rgba(184,212,227,0.08)" : "transparent",
                  border: selected
                    ? "1px solid rgba(184,212,227,0.20)"
                    : "1px solid rgba(255,255,255,0.06)",
                  transition: "all 150ms cubic-bezier(0.22, 1, 0.36, 1)",
                }}
                onClick={() => setAction(option.value)}
              >
                <span
                  style={{
                    width: 18,
                    height: 18,
                    marginTop: 1,
                    borderRadius: 9999,
                    border: selected ? "2px solid #B8D4E3" : "2px solid #6B7280",
                    display: "flex",
                    alignItems: "center",
                    justifyContent: "center",
                    flexShrink: 0,
                  }}
                >
                  {selected && (
                    <span
                      style={{
                        width: 8,
                        height: 8,
                        borderRadius: 9999,
                        background: "#B8D4E3",
                      }}
                    />
                  )}
                </span>
                <span style={{ display: "flex", flexDirection: "column", gap: 4 }}>
                  <span
                    style={{
                      fontFamily: "'Geist Sans', sans-serif",
                      fontSize: 14,
                      color: selected ? "#F2F2F2" : "#B8B3B0",
                      fontWeight: 500,
                    }}
                  >
                    {option.label}
                  </span>
                  <span
                    style={{
                      fontFamily: "'Geist Sans', sans-serif",
                      fontSize: 12,
                      color: "#6B7280",
                      lineHeight: 1.45,
                    }}
                  >
                    {option.description}
                  </span>
                </span>
              </label>
            );
          })}
        </div>

        <label
          style={{
            display: "flex",
            alignItems: "center",
            gap: 8,
            cursor: "pointer",
            marginBottom: 24,
          }}
          onClick={() => setRemember((value) => !value)}
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
              transition: "all 150ms cubic-bezier(0.22, 1, 0.36, 1)",
            }}
          >
            {remember && (
              <svg
                width="10"
                height="10"
                viewBox="0 0 24 24"
                fill="none"
                stroke="#B8D4E3"
                strokeWidth="3"
                strokeLinecap="round"
                strokeLinejoin="round"
              >
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
            }}
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
            }}
          >
            Confirm
          </button>
        </div>
      </div>
    </div>
  );
};

export { CloseConfirmModal };
