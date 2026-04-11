// ===== useIsFullscreen =====
// Reports whether the app window is currently in OS fullscreen mode.
// Detection uses window inner size vs screen size — this works for both
// Tauri window fullscreen and HTML5 requestFullscreen, and does not need
// any extra Tauri permission. Maximized (window filling only the working
// area minus taskbar) does NOT count as fullscreen because innerHeight
// would be smaller than screen.height in that case.

import { useEffect, useState } from "react";

function detectFullscreen(): boolean {
  if (typeof window === "undefined" || typeof screen === "undefined") return false;
  return (
    window.innerWidth === screen.width &&
    window.innerHeight === screen.height
  );
}

export function useIsFullscreen(): boolean {
  const [isFullscreen, setIsFullscreen] = useState(detectFullscreen);

  useEffect(() => {
    const check = () => setIsFullscreen(detectFullscreen());
    window.addEventListener("resize", check);
    // HTML5 fullscreen API also emits this event on some browsers
    document.addEventListener("fullscreenchange", check);
    return () => {
      window.removeEventListener("resize", check);
      document.removeEventListener("fullscreenchange", check);
    };
  }, []);

  return isFullscreen;
}
