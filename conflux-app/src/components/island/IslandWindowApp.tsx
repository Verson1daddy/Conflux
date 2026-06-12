import { useEffect, useState } from "react";
import { IslandBar } from "./IslandBar";
import { useAgentInstancesSync } from "@/hooks/useAgentInstances";
import { useIslandMode } from "@/hooks/useIslandMode";
import { markIslandWindowReady } from "@/lib/tauri-bridge";
import { useIslandStore } from "@/stores/islandStore";
import type { IslandMode } from "@/types";

function windowBackground(_mode: IslandMode): string {
  return "transparent";
}

export function IslandWindowApp() {
  // 批3 §1：岛窗只需副作用（首拉 + 事件桥接），不订阅数据 Map——
  // 原 useAgentInstances 返回值本就未消费，纯多余扇出。
  useAgentInstancesSync({ hydrateTrees: false });
  const { isHydrated } = useIslandMode({ preferBackendMode: true });
  const mode = useIslandStore((s) => s.mode) as IslandMode;
  const [isReady, setIsReady] = useState(false);

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

  useEffect(() => {
    if (!isHydrated) {
      setIsReady(false);
      return;
    }

    let innerFrame = 0;
    const frame = window.requestAnimationFrame(() => {
      innerFrame = window.requestAnimationFrame(() => {
        setIsReady(true);
      });
    });

    return () => {
      window.cancelAnimationFrame(frame);
      if (innerFrame) {
        window.cancelAnimationFrame(innerFrame);
      }
    };
  }, [isHydrated, mode]);

  useEffect(() => {
    if (!isReady) {
      return;
    }

    void markIslandWindowReady();
  }, [isReady, mode]);

  return (
    <div
      className="relative w-screen h-screen overflow-hidden"
      data-island-ready={isReady ? "true" : "false"}
      data-island-mode={mode}
      style={{
        background: windowBackground(mode),
      }}
    >
      {isHydrated ? <IslandBar /> : null}
    </div>
  );
}
