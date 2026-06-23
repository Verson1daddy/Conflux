// ===== 自绘标题栏窗口控制（无边框窗：decorations=false 后补回最小化/最大化/关闭）=====
//
// 背景：conmux 转 tmux 式无边框紧凑窗（tauri.conf.json decorations:false）——原生标题栏
// （那条多余的「框」）连同它的最小化/最大化/关闭一并消失，故在自绘 TopBar 右端补回这组控制。
// 拖动窗口走 TopBar 的 data-tauri-drag-region（见 TopBar.tsx），此组件只管三颗按钮。
//
// 视觉：贴合现有 chrome —— 透明底、hover 浅高亮（surface-base）、muted 字色；close 例外，
// hover 转 accent 红底白字（标准窗控约定）。窗控字形用 Windows 自带 Segoe MDL2 Assets，
// 以 \uXXXX 转义写入保源码纯 ASCII：E921 最小化 / E922 最大化 / E923 还原 / E8BB 关闭。
//
// 权限：minimize/toggleMaximize/isMaximized/close 已在 capabilities/default.json 显式放行。
// 失败一律 catch 吞（非 Windows / 权限缺失 → 降级不崩，按钮无操作）。

import { useEffect, useState, type CSSProperties, type FC } from "react";
import { getCurrentWindow } from "@tauri-apps/api/window";

// Segoe MDL2 Assets 窗控字形（\uXXXX 转义，源码纯 ASCII）。
const GLYPH_MINIMIZE = String.fromCharCode(0xe921);
const GLYPH_MAXIMIZE = String.fromCharCode(0xe922);
const GLYPH_RESTORE = String.fromCharCode(0xe923);
const GLYPH_CLOSE = String.fromCharCode(0xe8bb);

const ICON_FONT = "'Segoe Fluent Icons', 'Segoe MDL2 Assets', sans-serif";

const baseBtn: CSSProperties = {
  display: "inline-flex",
  alignItems: "center",
  justifyContent: "center",
  width: 30,
  height: 24,
  padding: 0,
  border: "none",
  borderRadius: 5,
  background: "transparent",
  color: "var(--cx-text-muted)",
  fontFamily: ICON_FONT,
  fontSize: 10,
  lineHeight: 1,
  cursor: "pointer",
  flex: "0 0 auto",
  WebkitUserSelect: "none",
  userSelect: "none",
};

interface CtrlButtonProps {
  testid: string;
  label: string;
  glyph: string;
  danger?: boolean;
  onClick: () => void;
}

const CtrlButton: FC<CtrlButtonProps> = ({ testid, label, glyph, danger, onClick }) => {
  const [hover, setHover] = useState(false);
  const style: CSSProperties = {
    ...baseBtn,
    background: hover
      ? danger
        ? "var(--cx-accent-signal)"
        : "var(--cx-surface-base)"
      : "transparent",
    color: hover && danger ? "#fff" : "var(--cx-text-muted)",
  };
  return (
    <button
      type="button"
      data-testid={testid}
      aria-label={label}
      title={label}
      onMouseEnter={() => setHover(true)}
      onMouseLeave={() => setHover(false)}
      onClick={onClick}
      style={style}
    >
      {glyph}
    </button>
  );
};

/** 三颗窗口控制按钮（最小化 / 最大化⇄还原 / 关闭），置于 TopBar 最右端。 */
const WindowControls: FC = () => {
  const [maximized, setMaximized] = useState(false);

  // 挂载时读一次最大化态 + 订阅 resize（含 OS 驱动的最大化，如双击拖拽区）保字形正确。
  // onResized 走 core:event listen（已放行）；失败吞，降级为仅点击后刷新。
  useEffect(() => {
    const win = getCurrentWindow();
    let unlisten: (() => void) | undefined;
    let cancelled = false;
    void win
      .isMaximized()
      .then((m) => {
        if (!cancelled) setMaximized(m);
      })
      .catch(() => {});
    void win
      .onResized(() => {
        void win
          .isMaximized()
          .then((m) => {
            if (!cancelled) setMaximized(m);
          })
          .catch(() => {});
      })
      .then((u) => {
        if (cancelled) u();
        else unlisten = u;
      })
      .catch(() => {});
    return () => {
      cancelled = true;
      unlisten?.();
    };
  }, []);

  const minimize = () => {
    void getCurrentWindow().minimize().catch(() => {});
  };
  const toggleMax = () => {
    const win = getCurrentWindow();
    void win
      .toggleMaximize()
      .then(() => win.isMaximized())
      .then(setMaximized)
      .catch(() => {});
  };
  const close = () => {
    void getCurrentWindow().close().catch(() => {});
  };

  return (
    <div
      data-testid="conmux-window-controls"
      style={{ display: "inline-flex", alignItems: "center", gap: 2, flex: "0 0 auto", marginLeft: 2 }}
    >
      <CtrlButton
        testid="conmux-win-minimize"
        label="最小化"
        glyph={GLYPH_MINIMIZE}
        onClick={minimize}
      />
      <CtrlButton
        testid="conmux-win-maximize"
        label={maximized ? "还原" : "最大化"}
        glyph={maximized ? GLYPH_RESTORE : GLYPH_MAXIMIZE}
        onClick={toggleMax}
      />
      <CtrlButton
        testid="conmux-win-close"
        label="关闭"
        glyph={GLYPH_CLOSE}
        danger
        onClick={close}
      />
    </div>
  );
};

export { WindowControls };
