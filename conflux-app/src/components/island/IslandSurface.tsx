import { forwardRef, type PropsWithChildren } from "react";
import type { IslandMode } from "@/types";

interface IslandSurfaceProps extends PropsWithChildren {
  mode: IslandMode;
}

const SURFACE_CLASS_BY_MODE: Record<IslandMode, string> = {
  top_island: "flex h-full w-full items-start justify-center",
  sidebar: "grid h-full w-full place-items-center",
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
