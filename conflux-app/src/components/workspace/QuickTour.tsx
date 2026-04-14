// ===== QuickTour =====
// C2-B1 Task 11.1: Floating card at bottom-right after onboarding completes.
// Shows a brief prompt to start a guided tour of the workspace.
// Auto-fades after 8 seconds. localStorage prevents re-showing.

import { type FC, useCallback, useEffect, useRef, useState } from "react";

const LS_KEY = "conflux.quickTourDismissed";

interface QuickTourProps {
  visible: boolean;
  onDismiss: () => void;
  onStart: () => void;
}

const QuickTour: FC<QuickTourProps> = ({ visible, onDismiss, onStart }) => {
  const [opacity, setOpacity] = useState(0);
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Skip rendering if already dismissed via localStorage
  const alreadyDismissed = typeof window !== "undefined" && localStorage.getItem(LS_KEY) === "true";

  // Entrance animation
  useEffect(() => {
    if (!visible || alreadyDismissed) return;
    // Small delay for mount -> animate
    const enterTimer = setTimeout(() => setOpacity(1), 50);
    return () => clearTimeout(enterTimer);
  }, [visible, alreadyDismissed]);

  // Auto-fade after 8 seconds
  useEffect(() => {
    if (!visible || alreadyDismissed) return;
    timerRef.current = setTimeout(() => {
      handleDismiss();
    }, 8000);
    return () => {
      if (timerRef.current) clearTimeout(timerRef.current);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [visible, alreadyDismissed]);

  const handleDismiss = useCallback(() => {
    setOpacity(0);
    localStorage.setItem(LS_KEY, "true");
    // Wait for fade-out transition before notifying parent
    setTimeout(() => {
      onDismiss();
    }, 300);
  }, [onDismiss]);

  const handleStart = useCallback(() => {
    localStorage.setItem(LS_KEY, "true");
    if (timerRef.current) clearTimeout(timerRef.current);
    onStart();
  }, [onStart]);

  if (!visible || alreadyDismissed) return null;

  return (
    <div
      style={{
        position: "fixed",
        bottom: 24,
        right: 24,
        zIndex: 45,
        width: 280,
        background: "rgba(255,255,255,0.04)",
        backdropFilter: "blur(24px)",
        WebkitBackdropFilter: "blur(24px)",
        border: "1px solid rgba(255,255,255,0.12)",
        borderRadius: 12,
        boxShadow: "0 12px 40px rgba(0,0,0,0.4)",
        padding: "20px 22px",
        opacity,
        transition: "opacity 0.3s cubic-bezier(0.22, 1, 0.36, 1)",
      }}
    >
      <h3 style={{
        fontFamily: "'Geist Sans',sans-serif",
        fontSize: 14,
        fontWeight: 600,
        color: "#F2F2F2",
        margin: 0,
        lineHeight: 1.3,
      }}>
        Quick Tour
      </h3>
      <p style={{
        fontFamily: "'Geist Sans',sans-serif",
        fontSize: 12,
        color: "#B8B3B0",
        margin: "8px 0 16px 0",
        lineHeight: 1.5,
      }}>
        Learn about canvas gestures, the island, discussions &amp; more.
      </p>
      <div style={{ display: "flex", alignItems: "center", gap: 8, justifyContent: "flex-end" }}>
        <button
          onClick={handleDismiss}
          style={{
            padding: "7px 14px",
            borderRadius: 9999,
            background: "rgba(255,255,255,0.04)",
            border: "1px solid rgba(255,255,255,0.082)",
            fontFamily: "'Geist Sans',sans-serif",
            fontSize: 12,
            fontWeight: 500,
            color: "#B8B3B0",
            cursor: "pointer",
          }}
        >
          Maybe later
        </button>
        <button
          onClick={handleStart}
          style={{
            padding: "7px 14px",
            borderRadius: 9999,
            background: "#B8D4E3",
            border: "none",
            fontFamily: "'Geist Sans',sans-serif",
            fontSize: 12,
            fontWeight: 600,
            color: "#0A0F15",
            cursor: "pointer",
          }}
        >
          Show me
        </button>
      </div>
    </div>
  );
};

export { QuickTour };
