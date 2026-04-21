import { type FC } from "react";

interface TopIslandPopoverProps {
  anchor: { x: number; y: number };
  onClose: () => void;
  onRestoreWorkspace: () => void;
}

export const TopIslandPopover: FC<TopIslandPopoverProps> = ({
  anchor,
  onClose,
  onRestoreWorkspace,
}) => {
  return (
    <div
      className="fixed"
      style={{
        zIndex: 40,
        left: anchor.x,
        top: anchor.y + 18,
        width: 1,
        height: 1,
      }}
    >
      <div className="sr-only">Top island popover placeholder</div>
      <button type="button" onClick={onRestoreWorkspace} className="sr-only">
        Restore workspace
      </button>
      <button type="button" onClick={onClose} className="sr-only">
        Close
      </button>
    </div>
  );
};
