// ===== Tooltip =====
// C2-B1 Task 11.2: Small positioned bubble for contextual tips.
// Dark bg, close button, auto-fades after 3 seconds.
// localStorage["conflux.tip.{tipKey}"] prevents re-showing.

import { type FC, useCallback, useEffect, useRef, useState } from "react";

interface TooltipProps {
  tipKey: string;
  text: string;
  position: { top: number; left: number };
  visible: boolean;
}

const Tooltip: FC<TooltipProps> = ({ tipKey, text, position, visible }) => {
  const [opacity, setOpacity] = useState(0);
  const [dismissed, setDismissed] = useState(false);
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const lsKey = `conflux.tip.${tipKey}`;
  const alreadyDismissed =
    typeof window !== "undefined" && localStorage.getItem(lsKey) === "true";

  // Entrance animation
  useEffect(() => {
    if (!visible || alreadyDismissed || dismissed) return;
    const enterTimer = setTimeout(() => setOpacity(1), 50);
    return () => clearTimeout(enterTimer);
  }, [visible, alreadyDismissed, dismissed]);

  // Auto-fade after 3 seconds
  useEffect(() => {
    if (!visible || alreadyDismissed || dismissed) return;
    timerRef.current = setTimeout(() => {
      dismiss();
    }, 3000);
    return () => {
      if (timerRef.current) clearTimeout(timerRef.current);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [visible, alreadyDismissed, dismissed]);

  const dismiss = useCallback(() => {
    setOpacity(0);
    localStorage.setItem(lsKey, "true");
    setTimeout(() => {
      setDismissed(true);
    }, 250);
  }, [lsKey]);

  if (!visible || alreadyDismissed || dismissed) return null;

  return (
    <div
      style={{
        position: "fixed",
        top: position.top,
        left: position.left,
        zIndex: 55,
        background: "#1C1E22",
        border: "1px solid rgba(255,255,255,0.12)",
        borderRadius: 8,
        padding: "10px 32px 10px 14px",
        boxShadow: "0 6px 24px rgba(0,0,0,0.35)",
        maxWidth: 260,
        opacity,
        transition: "opacity 0.25s cubic-bezier(0.22, 1, 0.36, 1)",
      }}
    >
      <span style={{
        fontFamily: "'Geist Sans',sans-serif",
        fontSize: 12,
        color: "#F2F2F2",
        lineHeight: 1.5,
      }}>
        {text}
      </span>
      <button
        onClick={dismiss}
        aria-label="Dismiss tip"
        style={{
          position: "absolute",
          top: 6,
          right: 8,
          width: 20,
          height: 20,
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          background: "none",
          border: "none",
          fontFamily: "'Geist Sans',sans-serif",
          fontSize: 14,
          color: "#6B7280",
          cursor: "pointer",
          lineHeight: 1,
          padding: 0,
        }}
      >
        {"\u00D7"}
      </button>
    </div>
  );
};

export { Tooltip };
