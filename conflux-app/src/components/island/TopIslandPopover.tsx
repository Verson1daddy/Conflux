import { type FC } from "react";

interface TopIslandPopoverProps {
  anchor: { x: number; y: number };
  onClose: () => void;
  onRestoreWorkspace: () => void;
}

export const TopIslandPopover: FC<TopIslandPopoverProps> = ({
  anchor,
  onClose,
  onRestoreWorkspace,
}) => {
  return (
    <div
      className="fixed inset-0 pointer-events-none"
      style={{ zIndex: 40 }}
      aria-hidden={false}
    >
      <div
        className="pointer-events-auto absolute"
        style={{
          left: anchor.x,
          top: anchor.y + 18,
          width: 280,
          transform: "translateX(-50%)",
          borderRadius: 20,
          border: "1px solid rgba(255,255,255,0.08)",
          background: "rgba(12, 14, 18, 0.94)",
          boxShadow: "0 18px 48px rgba(0, 0, 0, 0.42)",
          padding: 16,
        }}
      >
        <div className="flex items-start justify-between gap-3">
          <div className="min-w-0">
            <p
              style={{
                margin: 0,
                color: "#F5F7FA",
                fontFamily: "'Geist Sans', sans-serif",
                fontSize: 13,
                fontWeight: 600,
              }}
            >
              Top Island Popover
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
              Task 2 placeholder surface. Task 3 will replace this with the real content.
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
            aria-label="Close top island popover"
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
    </div>
  );
};
