import { type FC } from "react";

interface SidebarHotzoneProps {
  expanded: boolean;
  onHoverChange: (hovered: boolean) => void;
}

export const SidebarHotzone: FC<SidebarHotzoneProps> = ({
  expanded,
  onHoverChange,
}) => {
  return (
    <div
      className="fixed right-0 top-0 h-full"
      style={{
        zIndex: 30,
        width: 16,
        background: expanded ? "transparent" : "rgba(255,255,255,0.01)",
      }}
      onMouseEnter={() => onHoverChange(true)}
      onMouseLeave={() => onHoverChange(false)}
    />
  );
};
