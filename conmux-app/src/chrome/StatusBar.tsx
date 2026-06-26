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
  /** 当前屏上可见 pane 数（分屏时 = 布局矩形数；不分屏 = 1）。 */
  paneCount: number;
  /** 总会话数（缩点条上的会话点总数）。与 paneCount 不等时显 "可见/总"。 */
  sessionCount?: number;
  /** daemon 连接态（降级时 false → 运行点变暗）。 */
  daemonConnected: boolean;
  /** leader 待命态（M⑤c，armed 时显 ⌨ LEADER 徽章；让用户知道处于待命，不吞键无感）。 */
  leaderArmed?: boolean;
  /** 当前 leader 前缀标签（可配置化，armed 徽章显具体键，e.g. "⌃B"）。 */
  leaderLabel?: string;
}

const StatusBar: FC<StatusBarProps> = ({
  paneCount,
  sessionCount,
  daemonConnected,
  leaderArmed = false,
  leaderLabel = "⌃B",
}) => {
  // 可见 pane（分屏矩形数）；transient 为 0 时退回总会话数，避免闪 "0/N"。
  const total = sessionCount ?? paneCount;
  const visible = paneCount > 0 ? paneCount : total;
  const paneLabel = visible !== total ? `${visible}/${total}` : `${visible}`;
  return (
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
    {/* 运行点（ellipse 7 status.running；降级时变 idle）。真心跳轮询驱动 daemonConnected
        实时翻转——daemon 死亡 → idle 色。data-testid + aria-label 同 Home dot（a11y + 可测）。 */}
    <span
      data-testid="conmux-daemon-dot"
      data-connected={daemonConnected}
      role="img"
      aria-label={daemonConnected ? "daemon 已连接" : "daemon 未连接"}
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
    {/* leader 待命徽章（M⑤c §3）：armed 时显 ⌨ LEADER（accent + 轻脉冲，复用 .cx-dot-attention
        的 cx-pulse keyframe + reduced-motion fallback）；非 armed 不渲染。 */}
    {leaderArmed && (
      <span
        data-testid="conmux-leader-badge"
        className="cx-leader-badge"
        style={{
          ...META_TEXT,
          color: "var(--cx-accent-signal)",
          border: "1px solid var(--cx-accent-signal)",
          borderRadius: 4,
          padding: "1px 6px",
          flex: "0 0 auto",
        }}
      >
        ⌨ {leaderLabel}
      </span>
    )}
    <span style={META_TEXT}>DAEMON</span>
    <span style={META_TEXT} data-testid="conmux-pane-count">
      {paneLabel} PANES
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
};

export { StatusBar };
