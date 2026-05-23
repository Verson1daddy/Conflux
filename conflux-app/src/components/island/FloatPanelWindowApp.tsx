import { useEffect, useMemo, useState } from "react";
import { onCompactDetailReset } from "@/lib/event-listener";
import { readFloatPanelSnapshot, type FloatPanelSnapshot } from "@/lib/float-panel-snapshot";
import { hideFloatBallPanelWindow, showWorkspaceOnly } from "@/lib/tauri-bridge";
import { FloatBallPanel } from "./FloatBallPanel";

function transparentWindowBackground(): string {
  return "transparent";
}

export function FloatPanelWindowApp() {
  const [snapshot] = useState<FloatPanelSnapshot>(() =>
    readFloatPanelSnapshot()
  );
  const [isVisible, setIsVisible] = useState(true);
  const hasRenderableContent = useMemo(
    () =>
      snapshot.notifications.length > 0 || snapshot.pendingPermissions.length > 0,
    [snapshot.notifications.length, snapshot.pendingPermissions.length]
  );

  useEffect(() => {
    document.documentElement.style.background = transparentWindowBackground();
    document.body.style.background = transparentWindowBackground();
    document.body.style.margin = "0";
    document.body.style.overflow = "hidden";

    return () => {
      document.documentElement.style.background = "";
      document.body.style.background = "";
      document.body.style.margin = "";
      document.body.style.overflow = "";
    };
  }, []);

  useEffect(() => {
    let disposed = false;
    let unlisten: (() => void) | undefined;

    onCompactDetailReset((source) => {
      if (source !== "float_panel") {
        return;
      }

      setIsVisible(false);
    }).then((fn) => {
      if (disposed) {
        fn();
        return;
      }
      unlisten = fn;
    });

    return () => {
      disposed = true;
      unlisten?.();
    };
  }, []);

  useEffect(() => {
    if (!hasRenderableContent) {
      setIsVisible(false);
      return;
    }

    setIsVisible(true);
  }, [hasRenderableContent]);

  if (!isVisible || !hasRenderableContent) {
    return null;
  }

  return (
    <div
      className="relative w-screen h-screen overflow-hidden"
      style={{ background: transparentWindowBackground() }}
    >
      <FloatBallPanel
        notificationsOverride={snapshot.notifications}
        pendingPermissionsOverride={snapshot.pendingPermissions}
        onClose={() => {
          setIsVisible(false);
          void hideFloatBallPanelWindow();
        }}
        onOpenWorkspace={() => {
          setIsVisible(false);
          void showWorkspaceOnly();
        }}
      />
    </div>
  );
}
