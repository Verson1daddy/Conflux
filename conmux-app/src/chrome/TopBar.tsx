// ===== 缩点条（top taskbar，M③ F1 契约 §3/§4）=====
//
// 结构（跨风格不变，颜色走 CSS 变量绑 ChromeTokens）：
//   height 42 · fill surface.chrome · padding [0,14] · gap 10 · 底发丝线 1px。
//   左→右：conmux 字标（Fraunces italic 14 accent）→ 会话 pill/dots → flex spacer。
//
// 会话项 4 态（§4）：
//   ① 非活跃 = 裸点（ellipse 8-9，色=status.*）
//   ② 活跃 = 带名 pill（radius6 pad[6,11] accent 描边 = 状态点 + 会话名）
//   ③ hover = 就地展开带名 pill（M④ 多会话才有意义；M③ 占位）
//   ④ 需注意 = 点脉冲 accent.signal（M③ = 前端本地启发式占位，非控制面真路由 MF-3）
// M③ 单 pane = 仅一个活跃 pill（dots 多会话机制可建但只跑一个）。

import type { FC } from "react";
import type { SessionState, SessionStatus } from "./session-status";

const STATUS_VAR: Record<SessionStatus, string> = {
  running: "var(--cx-status-running)",
  idle: "var(--cx-status-idle)",
  warn: "var(--cx-status-warn)",
  attention: "var(--cx-accent-signal)",
};

/** 状态点（pill 内 / 裸点共用基元）。attention 态加脉冲动画。 */
const StatusDot: FC<{ status: SessionStatus; size: number }> = ({
  status,
  size,
}) => (
  <span
    className={status === "attention" ? "cx-dot cx-dot-attention" : "cx-dot"}
    style={{
      width: size,
      height: size,
      borderRadius: "50%",
      background: STATUS_VAR[status],
      flex: "0 0 auto",
    }}
  />
);

/** 单会话项：活跃 → 带名 pill；非活跃 → 裸点（M③ 单 pane 恒活跃）。 */
const SessionItem: FC<{ session: SessionState }> = ({ session }) => {
  if (!session.active) {
    // ① 非活跃 = 裸点（直径 9）
    return (
      <button
        type="button"
        className="cx-bare-dot"
        title={session.name}
        aria-label={session.name}
        data-instance-id={session.instanceId}
        style={{
          display: "inline-flex",
          alignItems: "center",
          background: "transparent",
          border: "none",
          padding: 4,
          cursor: "pointer",
        }}
      >
        <StatusDot status={session.status} size={9} />
      </button>
    );
  }
  // ② 活跃 = 带名 pill（radius6 pad[6,11] accent 描边 = 状态点 + 会话名）
  return (
    <div
      className="cx-session-pill"
      data-instance-id={session.instanceId}
      style={{
        display: "inline-flex",
        alignItems: "center",
        gap: 7,
        height: 26,
        padding: "0 11px",
        borderRadius: 6,
        background: "var(--cx-surface-base)",
        border: "1px solid var(--cx-accent-signal)",
        boxSizing: "border-box",
      }}
    >
      <StatusDot status={session.status} size={8} />
      <span
        style={{
          fontSize: 12,
          lineHeight: 1.2,
          color: "var(--cx-text-primary)",
          whiteSpace: "nowrap",
        }}
      >
        {session.name}
      </span>
    </div>
  );
};

const TopBar: FC<{ sessions: SessionState[] }> = ({ sessions }) => (
  <div
    data-testid="conmux-topbar"
    style={{
      display: "flex",
      alignItems: "center",
      gap: 10,
      height: 42,
      flex: "0 0 auto",
      padding: "0 14px",
      background: "var(--cx-surface-chrome)",
      borderBottom: "1px solid var(--cx-line-hairline)",
      boxSizing: "border-box",
    }}
  >
    {/* conmux 字标（Fraunces italic 14 accent） */}
    <span
      style={{
        fontFamily: "'Fraunces', 'Fraunces Variable', Georgia, serif",
        fontStyle: "italic",
        fontSize: 14,
        fontWeight: 500,
        color: "var(--cx-accent-signal)",
        letterSpacing: 0.2,
        flex: "0 0 auto",
      }}
    >
      conmux
    </span>
    {/* 会话 pill / dots */}
    <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
      {sessions.map((s) => (
        <SessionItem key={s.instanceId} session={s} />
      ))}
    </div>
    {/* flex spacer */}
    <div style={{ flex: 1 }} />
  </div>
);

export { TopBar };
