import { type FC } from "react";

interface FloatBallPanelProps {
  onClose: () => void;
  onRestoreWorkspace: () => void;
}

export const FloatBallPanel: FC<FloatBallPanelProps> = ({
  onClose,
  onRestoreWorkspace,
}) => {
  return (
    <div
      className="fixed top-6 right-6"
      style={{
        zIndex: 40,
        width: 1,
        height: 1,
      }}
    >
      <div className="sr-only">Float ball panel placeholder</div>
      <button type="button" onClick={onRestoreWorkspace} className="sr-only">
        Restore workspace
      </button>
      <button type="button" onClick={onClose} className="sr-only">
        Close
      </button>
    </div>
  );
};
