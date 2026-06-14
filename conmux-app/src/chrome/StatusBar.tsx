// ===== 状态栏（bottom，M③ F1 契约 §3）=====
//
// 结构（跨风格不变，颜色走 CSS 变量）：
//   height 30 · fill surface.chrome · padding [0,14] · gap 14 · 顶发丝线 1px。
//   运行点（ellipse 7 status.running）→ DAEMON / N PANES / UTF-8（JetBrains Mono 10
//   text.faint letterSpacing1 大写）→ flex spacer → WIN ⇄ WSL（同字体 accent.signal）。
//
// 换肤入口（§5）：状态栏右侧放一个 style 切换钮（点循环 A→B→C，localStorage 持久 +
// 即时应用）。命令面板 = M⑤，本轮不做。

import type { FC } from "react";

const META_TEXT: React.CSSProperties = {
  fontFamily: "'JetBrains Mono', 'JetBrains Mono Variable', monospace",
  fontSize: 10,
  letterSpacing: 1,
  textTransform: "uppercase",
  color: "var(--cx-text-faint)",
  whiteSpace: "nowrap",
};

interface StatusBarProps {
  /** 运行中的 pane 数（M③ 单 pane = 1；退出后 = 0）。 */
  paneCount: number;
  /** daemon 连接态（降级时 false → 运行点变暗）。 */
  daemonConnected: boolean;
  /** 当前风格名（切换钮展示）。 */
  styleName: string;
  /** 点切换钮：循环到下一风格。 */
  onCycleStyle: () => void;
}

const StatusBar: FC<StatusBarProps> = ({
  paneCount,
  daemonConnected,
  styleName,
  onCycleStyle,
}) => (
  <div
    data-testid="conmux-statusbar"
    style={{
      display: "flex",
      alignItems: "center",
      gap: 14,
      height: 30,
      flex: "0 0 auto",
      padding: "0 14px",
      background: "var(--cx-surface-chrome)",
      borderTop: "1px solid var(--cx-line-hairline)",
      boxSizing: "border-box",
    }}
  >
    {/* 运行点（ellipse 7 status.running；降级时变 idle） */}
    <span
      style={{
        width: 7,
        height: 7,
        borderRadius: "50%",
        background: daemonConnected
          ? "var(--cx-status-running)"
          : "var(--cx-status-idle)",
        flex: "0 0 auto",
      }}
    />
    <span style={META_TEXT}>DAEMON</span>
    <span style={META_TEXT}>{paneCount} PANES</span>
    <span style={META_TEXT}>UTF-8</span>

    {/* flex spacer */}
    <div style={{ flex: 1 }} />

    {/* WIN ⇄ WSL（M③ 单 pane 本地 powershell；跨边界语义预留 accent） */}
    <span style={{ ...META_TEXT, color: "var(--cx-accent-signal)" }}>
      WIN ⇄ WSL
    </span>

    {/* 换肤切换钮（点循环 A→B→C）。命令面板 = M⑤。 */}
    <button
      type="button"
      data-testid="conmux-style-cycle"
      onClick={onCycleStyle}
      title="切换风格（A → B → C）"
      style={{
        ...META_TEXT,
        color: "var(--cx-text-muted)",
        background: "transparent",
        border: "1px solid var(--cx-line-soft)",
        borderRadius: 6,
        padding: "2px 8px",
        cursor: "pointer",
        lineHeight: 1.4,
      }}
    >
      ◐ {styleName}
    </button>
  </div>
);

export { StatusBar };
