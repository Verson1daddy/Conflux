import { useEffect } from "react";
import { IslandBar } from "./IslandBar";
import { useAgentInstances } from "@/hooks/useAgentInstances";
import { useIslandMode } from "@/hooks/useIslandMode";
import { useIslandStore } from "@/stores/islandStore";
import type { IslandMode } from "@/types";

function windowBackground(mode: IslandMode): string {
  return mode === "sidebar" ? "#050507" : "transparent";
}

export function IslandWindowApp() {
  useAgentInstances({ hydrateTrees: false });
  useIslandMode();
  const mode = useIslandStore((s) => s.mode) as IslandMode;

  useEffect(() => {
    document.documentElement.style.background = windowBackground(mode);
    document.body.style.background = windowBackground(mode);
    document.body.style.margin = "0";
    document.body.style.overflow = "hidden";

    return () => {
      document.documentElement.style.background = "";
      document.body.style.background = "";
      document.body.style.margin = "";
      document.body.style.overflow = "";
    };
  }, [mode]);

  return (
    <div
      className="relative w-screen h-screen overflow-hidden"
      style={{ background: windowBackground(mode) }}
    >
      <IslandBar />
    </div>
  );
}
