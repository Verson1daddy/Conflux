import { forwardRef, type PropsWithChildren } from "react";
import type { IslandMode } from "@/types";

interface IslandSurfaceProps extends PropsWithChildren {
  mode: IslandMode;
}

const SURFACE_CLASS_BY_MODE: Record<IslandMode, string> = {
  top_island: "flex h-full w-full items-start justify-center pt-3",
  float_ball: "flex h-full w-full items-start justify-center pt-5",
  sidebar: "flex h-full w-full items-stretch justify-start",
};

export const IslandSurface = forwardRef<HTMLDivElement, IslandSurfaceProps>(
  ({ children, mode }, ref) => {
    return (
      <div
        ref={ref}
        className={`island-shell ${SURFACE_CLASS_BY_MODE[mode]}`}
        data-mode={mode}
      >
        {children}
      </div>
    );
  }
);

IslandSurface.displayName = "IslandSurface";
