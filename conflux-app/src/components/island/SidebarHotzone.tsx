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
      aria-hidden="true"
      className={expanded ? "sidebar-hotzone is-active" : "sidebar-hotzone"}
      onMouseEnter={() => onHoverChange(true)}
      onMouseLeave={() => onHoverChange(false)}
    />
  );
};
