import { type FC } from "react";

interface SidebarHotzoneProps {
  expanded: boolean;
  onExpandedChange: (expanded: boolean) => void;
}

export const SidebarHotzone: FC<SidebarHotzoneProps> = ({
  expanded,
  onExpandedChange,
}) => {
  return (
    <div
      role="button"
      tabIndex={0}
      aria-label="Open sidebar"
      aria-expanded={expanded}
      className="fixed right-0 top-0 h-full"
      style={{
        zIndex: 30,
        width: 16,
        background: expanded ? "transparent" : "rgba(255,255,255,0.01)",
      }}
      onMouseEnter={() => onExpandedChange(true)}
      onFocus={() => onExpandedChange(true)}
    />
  );
};
