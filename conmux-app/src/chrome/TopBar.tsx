// ===== 缩点条（top taskbar，F1 视觉契约 §3 度量 / §4 四态）=====
//
// 结构（跨风格不变，颜色走 CSS 变量绑 ChromeTokens）：
//   height 42 · fill surface.chrome · padding [0,14] · gap 10 · 底发丝线 1px。
//   左→右：conmux 字标（Fraunces italic 14 accent）→ 会话项序列 → flex spacer
//          → 「+」新建钮 → 换肤钮。
//
// 会话项 4 态（§4 / M④ 契约 §2）：
//   ① 非活跃 = 裸点（ellipse 9px，色=status.*：running/idle/warn/exited）。
//   ② 活跃 = 带名 pill（radius6 fill surface.base accent 描边，dot7px + name(mono12)，pad[6,11] gap7）。
//   ③ hover 裸点 = 就地展开带名 pill（soft 描边 line.soft，区别于 active 的 accent 描边）。
//   ④ 需注意 = 点用 accent.signal + 外发光脉冲（M3-ext 本地启发式占位，MF-3 非控制面真路由）。
//
// 交互（M④）：
//   click 会话项 → onSelect(instanceId)（body 换该会话终端 + aware-header 换该会话态）。
//   「+」→ onCreate()（create_session powershell → 新点 + setActive）。
//   active pill hover 出 × → onClose(instanceId)（kill_session + store 移除）。

import { useState, type FC } from "react";
import type { SessionState, SessionStatus } from "./session-status";
import { ConmuxBrandMark } from "./ConmuxBrandMark";

const STATUS_VAR: Record<SessionStatus, string> = {
  running: "var(--cx-status-running)",
  idle: "var(--cx-status-idle)",
  warn: "var(--cx-status-warn)",
  attention: "var(--cx-accent-signal)",
};

const MONO = "'JetBrains Mono', 'JetBrains Mono Variable', monospace";

/** 状态点（pill 内 / 裸点共用基元）。attention 态加脉冲动画（外发光）。 */
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

interface SessionItemProps {
  session: SessionState;
  onSelect: (instanceId: string) => void;
  onClose: (instanceId: string) => void;
}

/**
 * 单会话项。
 *   active → 带名 pill（accent 描边）+ hover 出 ×（关闭）。
 *   非 active → 裸点；hover → 就地展开带名 pill（soft 描边）。
 */
const SessionItem: FC<SessionItemProps> = ({ session, onSelect, onClose }) => {
  const [hover, setHover] = useState(false);

  // 带名 pill 渲染（active 与 hover-expand 共用骨架，仅描边色 + × 显隐不同）。
  const renderPill = (variant: "active" | "hover") => {
    const isActive = variant === "active";
    return (
      <div
        className="cx-session-pill"
        data-testid={`conmux-session-${session.instanceId}`}
        data-instance-id={session.instanceId}
        data-active={isActive ? "true" : "false"}
        data-status={session.status}
        onMouseEnter={() => setHover(true)}
        onMouseLeave={() => setHover(false)}
        onClick={() => onSelect(session.instanceId)}
        style={{
          display: "inline-flex",
          alignItems: "center",
          gap: 7,
          height: 26,
          // active：与状态栏换肤钮一致的 pad[6,11]；含 × 时右侧留白略减。
          padding: isActive && hover ? "0 6px 0 11px" : "0 11px",
          borderRadius: 6,
          background: "var(--cx-surface-base)",
          // ② active = accent 描边；③ hover-expand = soft 描边（区别 active）。
          border: isActive
            ? "1px solid var(--cx-accent-signal)"
            : "1px solid var(--cx-line-soft)",
          boxSizing: "border-box",
          cursor: "pointer",
          whiteSpace: "nowrap",
        }}
      >
        <StatusDot status={session.status} size={7} />
        <span
          style={{
            fontFamily: MONO,
            fontSize: 12,
            lineHeight: 1.2,
            color: "var(--cx-text-content)",
          }}
        >
          {session.name}
        </span>
        {/* 关闭入口：仅 active pill 在 hover 时露出 ×（kill_session + 移除）。 */}
        {isActive && hover && (
          <button
            type="button"
            className="cx-session-close"
            data-testid={`conmux-session-close-${session.instanceId}`}
            aria-label={`关闭会话 ${session.name}`}
            title="关闭会话"
            onClick={(e) => {
              e.stopPropagation(); // 不触发 onSelect
              onClose(session.instanceId);
            }}
            style={{
              display: "inline-flex",
              alignItems: "center",
              justifyContent: "center",
              width: 16,
              height: 16,
              marginLeft: 1,
              padding: 0,
              border: "none",
              borderRadius: 4,
              background: "transparent",
              color: "var(--cx-text-muted)",
              fontFamily: MONO,
              fontSize: 13,
              lineHeight: 1,
              cursor: "pointer",
            }}
          >
            ×
          </button>
        )}
      </div>
    );
  };

  if (session.active) {
    return renderPill("active");
  }

  // ③ hover 裸点 → 就地展开带名 pill（soft 描边）。
  if (hover) {
    return renderPill("hover");
  }

  // ① 非活跃 = 裸点（直径 9，色=status.*）。
  return (
    <button
      type="button"
      className="cx-bare-dot"
      data-testid={`conmux-session-${session.instanceId}`}
      data-instance-id={session.instanceId}
      data-active="false"
      data-status={session.status}
      title={session.name}
      aria-label={session.name}
      onMouseEnter={() => setHover(true)}
      onMouseLeave={() => setHover(false)}
      onClick={() => onSelect(session.instanceId)}
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
};

interface TopBarProps {
  sessions: SessionState[];
  onSelect: (instanceId: string) => void;
  onCreate: () => void;
  onClose: (instanceId: string) => void;
  /** 当前风格名（换肤钮展示）。 */
  styleName: string;
  /** 点切换钮：循环到下一风格。 */
  onCycleStyle: () => void;
}

const TopBar: FC<TopBarProps> = ({
  sessions,
  onSelect,
  onCreate,
  onClose,
  styleName,
  onCycleStyle,
}) => (
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
    {/* conmux 字标（花瓣自适应对比色 + "conmux" Fraunces italic accent，无背景） */}
    <div style={{ display: "flex", alignItems: "center", gap: 6, flex: "0 0 auto" }}>
      <ConmuxBrandMark size={15} color="var(--cx-text-primary)" />
      <span
        style={{
          fontFamily: "'Fraunces', 'Fraunces Variable', Georgia, serif",
          fontStyle: "italic",
          fontSize: 14,
          fontWeight: 500,
          color: "var(--cx-accent-signal)",
          letterSpacing: 0.2,
        }}
      >
        conmux
      </span>
    </div>

    {/* 会话项序列（裸点 / 带名 pill / hover 展开 / attention 脉冲）。 */}
    <div
      data-testid="conmux-session-list"
      style={{ display: "flex", alignItems: "center", gap: 8, minWidth: 0 }}
    >
      {sessions.map((s) => (
        <SessionItem
          key={s.instanceId}
          session={s}
          onSelect={onSelect}
          onClose={onClose}
        />
      ))}
    </div>

    {/* flex spacer */}
    <div style={{ flex: 1 }} />

    {/* 「+」新建会话钮（create_session powershell → 新点 + setActive）。 */}
    <button
      type="button"
      data-testid="conmux-session-new"
      aria-label="新建会话"
      title="新建会话（powershell）"
      onClick={onCreate}
      style={{
        display: "inline-flex",
        alignItems: "center",
        justifyContent: "center",
        width: 24,
        height: 24,
        padding: 0,
        border: "1px solid var(--cx-line-soft)",
        borderRadius: 6,
        background: "transparent",
        color: "var(--cx-text-muted)",
        fontFamily: MONO,
        fontSize: 16,
        lineHeight: 1,
        cursor: "pointer",
        flex: "0 0 auto",
      }}
    >
      +
    </button>

    {/* 换肤钮（点循环 A→B→C，localStorage 持久 + 即时应用；移自状态栏 per M④ §2）。 */}
    <button
      type="button"
      data-testid="conmux-style-cycle"
      onClick={onCycleStyle}
      title="切换风格（A → B → C）"
      style={{
        fontFamily: MONO,
        fontSize: 10,
        letterSpacing: 1,
        textTransform: "uppercase",
        color: "var(--cx-text-muted)",
        background: "transparent",
        border: "1px solid var(--cx-line-soft)",
        borderRadius: 6,
        padding: "4px 8px",
        cursor: "pointer",
        lineHeight: 1.2,
        flex: "0 0 auto",
        whiteSpace: "nowrap",
      }}
    >
      ◐ {styleName}
    </button>
  </div>
);

export { TopBar };
