import { type FC } from "react";

interface FloatBallPanelProps {
  onClose: () => void;
  onRestoreWorkspace: () => void;
}

export const FloatBallPanel: FC<FloatBallPanelProps> = ({
  onClose,
  onRestoreWorkspace,
}) => {
  return (
    <div
      className="fixed top-6 right-6"
      style={{
        zIndex: 40,
        width: 260,
        borderRadius: 24,
        border: "1px solid rgba(255,255,255,0.08)",
        background: "rgba(12, 14, 18, 0.94)",
        boxShadow: "0 18px 48px rgba(0, 0, 0, 0.42)",
        padding: 16,
      }}
    >
      <div className="flex items-start justify-between gap-3">
        <div>
          <p
            style={{
              margin: 0,
              color: "#F5F7FA",
              fontFamily: "'Geist Sans', sans-serif",
              fontSize: 13,
              fontWeight: 600,
            }}
          >
            Float Ball Panel
          </p>
          <p
            style={{
              margin: "6px 0 0",
              color: "rgba(255,255,255,0.6)",
              fontFamily: "'Geist Sans', sans-serif",
              fontSize: 11,
              lineHeight: 1.45,
            }}
          >
            Placeholder contract for Task 4 expansion.
          </p>
        </div>
        <button
          type="button"
          onClick={onClose}
          style={{
            border: "none",
            background: "transparent",
            color: "rgba(255,255,255,0.56)",
            cursor: "pointer",
          }}
          aria-label="Close float ball panel"
        >
          ×
        </button>
      </div>

      <div className="mt-4 flex items-center gap-2">
        <button
          type="button"
          onClick={onRestoreWorkspace}
          style={{
            border: "none",
            borderRadius: 9999,
            padding: "8px 12px",
            background: "#B8D4E3",
            color: "#081018",
            fontFamily: "'Geist Sans', sans-serif",
            fontSize: 11,
            fontWeight: 600,
            cursor: "pointer",
          }}
        >
          Show Workspace
        </button>
        <button
          type="button"
          onClick={onClose}
          style={{
            border: "1px solid rgba(255,255,255,0.08)",
            borderRadius: 9999,
            padding: "8px 12px",
            background: "transparent",
            color: "rgba(255,255,255,0.72)",
            fontFamily: "'Geist Sans', sans-serif",
            fontSize: 11,
            fontWeight: 500,
            cursor: "pointer",
          }}
        >
          Close
        </button>
      </div>
    </div>
  );
};
