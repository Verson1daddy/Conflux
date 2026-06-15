// ===== 状态栏（bottom，F1 视觉契约 §3）=====
//
// 结构（跨风格不变，颜色走 CSS 变量）：
//   height 30 · fill surface.chrome · padding [0,14] · gap 14 · 顶发丝线 1px。
//   运行点（ellipse 7 status.running）→ DAEMON / N PANES / UTF-8（JetBrains Mono 10
//   text.faint letterSpacing1 大写）→ flex spacer → WIN ⇄ WSL（同字体 accent.signal）。
//
// M④：换肤钮移至缩点条 TopBar（per 契约 §2）；状态栏专注 daemon/pane 计数 + 边界语义。

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
  /** 运行中的 pane 数（M④ 多会话 = 当前活跃会话数）。 */
  paneCount: number;
  /** daemon 连接态（降级时 false → 运行点变暗）。 */
  daemonConnected: boolean;
}

const StatusBar: FC<StatusBarProps> = ({ paneCount, daemonConnected }) => (
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
    <span style={META_TEXT} data-testid="conmux-pane-count">
      {paneCount} PANES
    </span>
    <span style={META_TEXT}>UTF-8</span>

    {/* flex spacer */}
    <div style={{ flex: 1 }} />

    {/* WIN ⇄ WSL（M④ 本地 powershell；跨边界语义预留 accent） */}
    <span style={{ ...META_TEXT, color: "var(--cx-accent-signal)" }}>
      WIN ⇄ WSL
    </span>
  </div>
);

export { StatusBar };
