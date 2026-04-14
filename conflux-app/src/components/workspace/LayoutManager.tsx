// ===== LayoutManager Component =====
// Floating toolbar in the top-right corner of the canvas.
// Provides layout mode switching (Free / Grid / AutoPack) and
// AutoPack configuration dropdown with sort/size strategy and "repack now" button.

import { useState, useCallback, useRef, useEffect } from "react";
import { useWorkspaceStore } from "@/stores/workspaceStore";
import type {
  LayoutMode,
  PackSortStrategy,
  CardSizePreset,
} from "@/types";

// ===== Layout mode metadata =====

interface LayoutModeOption {
  mode: LayoutMode;
  label: string;
  icon: string;
  title: string;
}

const LAYOUT_MODES: LayoutModeOption[] = [
  { mode: "free", label: "Free", icon: "⊞", title: "Free-form layout: drag cards anywhere" },
  { mode: "grid", label: "Grid", icon: "⊟", title: "Grid layout: aligned to rows and columns" },
  { mode: "auto_pack", label: "Pack", icon: "⊠", title: "AutoPack: automatic arrangement" },
];

// ===== AutoPack strategy options =====

const SORT_STRATEGIES: { value: PackSortStrategy; label: string }[] = [
  { value: "by_activity", label: "By Activity" },
  { value: "by_created_time", label: "By Created Time" },
  { value: "by_framework_group", label: "By Framework" },
];

const SIZE_PRESETS: { value: CardSizePreset; label: string }[] = [
  { value: "smart", label: "Smart" },
  { value: "uniform", label: "Uniform" },
  { value: "shuffle", label: "Shuffle" },
];

// ===== Props =====

interface LayoutManagerProps {
  /** Callback to trigger AutoPack from the hook */
  onAutoPack: () => void;
}

/**
 * LayoutManager renders a floating toolbar for layout mode switching and
 * AutoPack configuration. Positioned in the top-right corner of the canvas.
 */
function LayoutManager({ onAutoPack }: LayoutManagerProps) {
  const {
    layoutMode,
    autoPackConfig,
    setLayoutMode,
    setAutoPackConfig,
  } = useWorkspaceStore();

  const [dropdownOpen, setDropdownOpen] = useState(false);
  const [collapsed, setCollapsed] = useState(false);
  const dropdownRef = useRef<HTMLDivElement>(null);

  // ===== Close dropdown on outside click =====
  useEffect(() => {
    if (!dropdownOpen) return;

    function handleClickOutside(e: MouseEvent) {
      if (
        dropdownRef.current &&
        !dropdownRef.current.contains(e.target as Node)
      ) {
        setDropdownOpen(false);
      }
    }

    document.addEventListener("pointerdown", handleClickOutside);
    return () => {
      document.removeEventListener("pointerdown", handleClickOutside);
    };
  }, [dropdownOpen]);

  // ===== Mode switch handler =====
  const handleModeClick = useCallback(
    (mode: LayoutMode) => {
      setLayoutMode(mode);
      // Show dropdown automatically when switching to auto_pack
      if (mode === "auto_pack") {
        setDropdownOpen(true);
      } else {
        setDropdownOpen(false);
      }
    },
    [setLayoutMode]
  );

  // ===== AutoPack config change handlers =====
  const handleSortChange = useCallback(
    (e: React.ChangeEvent<HTMLSelectElement>) => {
      setAutoPackConfig({
        ...autoPackConfig,
        sort_strategy: e.target.value as PackSortStrategy,
      });
    },
    [autoPackConfig, setAutoPackConfig]
  );

  const handleSizePresetChange = useCallback(
    (e: React.ChangeEvent<HTMLSelectElement>) => {
      setAutoPackConfig({
        ...autoPackConfig,
        size_preset: e.target.value as CardSizePreset,
      });
    },
    [autoPackConfig, setAutoPackConfig]
  );

  const handleRepackClick = useCallback(() => {
    onAutoPack();
    setDropdownOpen(false);
  }, [onAutoPack]);

  const toggleDropdown = useCallback(() => {
    setDropdownOpen((prev) => !prev);
  }, []);

  return (
    <div
      className="absolute top-4 right-4 z-20 flex flex-col items-end gap-2"
      ref={dropdownRef}
    >
      {/* ===== Collapse/Expand toggle + Mode toggle bar ===== */}
      <div className="glass rounded-lg flex items-center p-1 gap-0.5">
        {/* Collapse toggle */}
        <button
          className="px-1.5 py-1.5 rounded-md text-xs text-white/40 hover:text-white/80 hover:bg-white/5 transition-colors duration-150"
          onClick={() => setCollapsed((v) => !v)}
          title={collapsed ? "Expand layout toolbar" : "Collapse layout toolbar"}
        >
          {collapsed ? "◂" : "▸"}
        </button>

        {!collapsed && (
          <>
            {LAYOUT_MODES.map((opt) => (
              <button
                key={opt.mode}
                className={[
                  "px-3 py-1.5 rounded-md text-xs font-body transition-colors duration-150",
                  layoutMode === opt.mode
                    ? "bg-accent/20 text-accent"
                    : "text-white/50 hover:text-white/80 hover:bg-white/5",
                ].join(" ")}
                onClick={() => handleModeClick(opt.mode)}
                title={opt.title}
              >
                <span className="mr-1">{opt.icon}</span>
                {opt.label}
              </button>
            ))}

            {/* AutoPack dropdown toggle (only visible in auto_pack mode) */}
            {layoutMode === "auto_pack" && (
              <button
                className={[
                  "ml-1 px-2 py-1.5 rounded-md text-xs transition-colors duration-150",
                  dropdownOpen
                    ? "bg-accent/20 text-accent"
                    : "text-white/40 hover:text-white/70 hover:bg-white/5",
                ].join(" ")}
                onClick={toggleDropdown}
                title="AutoPack settings"
              >
                ▾
              </button>
            )}
          </>
        )}
      </div>

      {/* ===== AutoPack dropdown ===== */}
      {!collapsed && layoutMode === "auto_pack" && dropdownOpen && (
        <div className="glass rounded-lg p-3 min-w-[220px] flex flex-col gap-3">
          {/* Sort strategy */}
          <label className="flex flex-col gap-1">
            <span className="text-[10px] font-mono text-white/40 uppercase tracking-wider">
              Sort By
            </span>
            <select
              className="bg-white/5 border border-white/10 rounded px-2 py-1 text-xs text-white/80 font-body outline-none focus:border-accent/40"
              value={autoPackConfig.sort_strategy}
              onChange={handleSortChange}
            >
              {SORT_STRATEGIES.map((s) => (
                <option key={s.value} value={s.value} className="bg-surface-dark">
                  {s.label}
                </option>
              ))}
            </select>
          </label>

          {/* Size preset */}
          <label className="flex flex-col gap-1">
            <span className="text-[10px] font-mono text-white/40 uppercase tracking-wider">
              Card Size
            </span>
            <select
              className="bg-white/5 border border-white/10 rounded px-2 py-1 text-xs text-white/80 font-body outline-none focus:border-accent/40"
              value={autoPackConfig.size_preset}
              onChange={handleSizePresetChange}
            >
              {SIZE_PRESETS.map((s) => (
                <option key={s.value} value={s.value} className="bg-surface-dark">
                  {s.label}
                </option>
              ))}
            </select>
          </label>

          {/* Repack button */}
          <button
            className="bg-accent/20 hover:bg-accent/30 text-accent text-xs font-body py-1.5 px-3 rounded transition-colors duration-150"
            onClick={handleRepackClick}
          >
            Repack Now
          </button>
        </div>
      )}
    </div>
  );
}

export { LayoutManager };
export type { LayoutManagerProps };
