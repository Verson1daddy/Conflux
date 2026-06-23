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
//   ④ 需注意 = 点用 accent.signal + 外发光脉冲（MF-3 真路由：非活跃会话 BEL/退出真信号触发，
//      切到该会话即清；见 session-status.ts 头注释）。
//
// 交互（M④）：
//   click 会话项 → onSelect(instanceId)（body 换该会话终端 + aware-header 换该会话态）。
//   「+」→ onCreate()（create_session powershell → 新点 + setActive）。
//   active pill hover 出 × → onClose(instanceId)（kill_session + store 移除）。

import { useEffect, useState, type FC } from "react";
import type { SessionState, SessionStatus } from "./session-status";
import { ConmuxBrandMark } from "./ConmuxBrandMark";
import { WindowControls } from "./WindowControls";

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
  /** 右键会话项 → 在 (x,y) 开小菜单（切换/重启/移除）。 */
  onContextMenu: (instanceId: string, x: number, y: number) => void;
}

/**
 * 单会话项。
 *   active → 带名 pill（accent 描边）+ hover 出 ×（关闭）。
 *   非 active → 裸点；hover → 就地展开带名 pill（soft 描边）。
 *   右键（任意态）→ 小菜单（切换/重启/移除）。
 */
const SessionItem: FC<SessionItemProps> = ({
  session,
  onSelect,
  onClose,
  onContextMenu,
}) => {
  const [hover, setHover] = useState(false);
  const openMenu = (e: { preventDefault: () => void; clientX: number; clientY: number }) => {
    e.preventDefault();
    onContextMenu(session.instanceId, e.clientX, e.clientY);
  };

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
        onContextMenu={openMenu}
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
      onContextMenu={openMenu}
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
  /** 退出态右键菜单「重启」：从该会话 launchCommand 复原新会话。 */
  onRestart: (instanceId: string) => void;
  /** 当前风格名（换肤钮展示）。 */
  styleName: string;
  /** 点切换钮：循环到下一风格。 */
  onCycleStyle: () => void;
}

/** 右键菜单的一项（mono 12，hover 高亮 surface-chrome；danger=移除走 warn 色）。 */
const MenuItem: FC<{
  testid: string;
  label: string;
  danger?: boolean;
  autoFocus?: boolean;
  onClick: () => void;
}> = ({ testid, label, danger, autoFocus, onClick }) => {
  const [h, setH] = useState(false);
  return (
    <button
      type="button"
      role="menuitem"
      data-testid={testid}
      autoFocus={autoFocus}
      onMouseEnter={() => setH(true)}
      onMouseLeave={() => setH(false)}
      onClick={onClick}
      style={{
        display: "block",
        width: "100%",
        textAlign: "left",
        padding: "6px 10px",
        border: "none",
        borderRadius: 5,
        background: h ? "var(--cx-surface-chrome)" : "transparent",
        color: danger ? "var(--cx-status-warn)" : "var(--cx-text-content)",
        fontFamily: MONO,
        fontSize: 12,
        lineHeight: 1.3,
        cursor: "pointer",
        whiteSpace: "nowrap",
        boxSizing: "border-box",
      }}
    >
      {label}
    </button>
  );
};

const MENU_W = 176;
const MENU_H = 140;

const TopBar: FC<TopBarProps> = ({
  sessions,
  onSelect,
  onCreate,
  onClose,
  onRestart,
  styleName,
  onCycleStyle,
}) => {
  // 会话点右键菜单：{instanceId,x,y} | null（一次一个）。
  const [menu, setMenu] = useState<{ instanceId: string; x: number; y: number } | null>(null);
  const closeMenu = () => setMenu(null);

  // 目标会话（被移除/重启换 id → null）。
  const menuSession = menu
    ? sessions.find((s) => s.instanceId === menu.instanceId) ?? null
    : null;

  // 菜单开时 Esc 关闭；目标会话消失则自动收起。
  useEffect(() => {
    if (!menu) return;
    if (!menuSession) {
      setMenu(null);
      return;
    }
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        e.stopPropagation();
        setMenu(null);
      }
    };
    document.addEventListener("keydown", onKey, true);
    return () => document.removeEventListener("keydown", onKey, true);
  }, [menu, menuSession]);

  // 菜单项（按会话态裁剪）：切换(非活跃) / 重启(已退出) / 移除。
  const menuItems = menuSession
    ? [
        ...(menuSession.active
          ? []
          : [
              {
                testid: "conmux-session-menu-switch",
                label: "切换到此会话",
                onClick: () => {
                  onSelect(menuSession.instanceId);
                  closeMenu();
                },
              },
            ]),
        ...(menuSession.exited
          ? [
              {
                testid: "conmux-session-menu-restart",
                label: "重启会话",
                onClick: () => {
                  onRestart(menuSession.instanceId);
                  closeMenu();
                },
              },
            ]
          : []),
        {
          testid: "conmux-session-menu-remove",
          label: "移除会话",
          danger: true,
          onClick: () => {
            onClose(menuSession.instanceId);
            closeMenu();
          },
        },
      ]
    : [];

  // 坐标 clamp 进视口（留 8px 边距）。
  const clampX = menu ? Math.max(8, Math.min(menu.x, window.innerWidth - MENU_W - 8)) : 0;
  const clampY = menu ? Math.max(8, Math.min(menu.y, window.innerHeight - MENU_H - 8)) : 0;

  return (
  // 无边框窗自绘标题栏：缩点条本身作窗口拖拽区（data-tauri-drag-region）——
  // Tauri 仅当 mousedown 的「直接目标」带此属性才发起拖拽，故会话点/按钮/窗控等交互子元素
  // （它们是事件目标且无此属性）照常可点，只有空白条体与 spacer 触发拖窗；双击拖拽区切最大化。
  <div
    data-testid="conmux-topbar"
    data-tauri-drag-region
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
          onContextMenu={(id, x, y) => setMenu({ instanceId: id, x, y })}
        />
      ))}
    </div>

    {/* flex spacer（同时是主拖拽区：中段大片空白） */}
    <div data-tauri-drag-region style={{ flex: 1 }} />

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

    {/* 窗口控制（无边框窗自绘标题栏：最小化 / 最大化⇄还原 / 关闭），最右端。 */}
    <WindowControls />

    {/* 会话点右键小菜单（scrim 捕获外点 + 视口内定位卡片；Esc 关）。 */}
    {menu && menuSession && (
      <>
        <div
          data-testid="conmux-session-menu-scrim"
          onClick={closeMenu}
          onContextMenu={(e) => {
            e.preventDefault();
            closeMenu();
          }}
          style={{ position: "fixed", inset: 0, zIndex: 60 }}
        />
        <div
          role="menu"
          aria-label={`会话 ${menuSession.name} 操作`}
          data-testid="conmux-session-menu"
          data-instance-id={menuSession.instanceId}
          style={{
            position: "fixed",
            left: clampX,
            top: clampY,
            zIndex: 61,
            minWidth: MENU_W,
            padding: 4,
            borderRadius: 8,
            background: "var(--cx-surface-raised)",
            border: "1px solid var(--cx-line-soft)",
            boxShadow: "0 8px 24px rgba(0, 0, 0, 0.28)",
            boxSizing: "border-box",
          }}
        >
          <div
            style={{
              padding: "4px 10px 6px",
              marginBottom: 4,
              borderBottom: "1px solid var(--cx-line-hairline)",
              fontFamily: MONO,
              fontSize: 11,
              color: "var(--cx-text-faint)",
              whiteSpace: "nowrap",
            }}
          >
            {menuSession.name}
            {menuSession.exited ? " · 已退出" : ""}
          </div>
          {menuItems.map((it, i) => (
            <MenuItem
              key={it.testid}
              testid={it.testid}
              label={it.label}
              danger={it.danger}
              autoFocus={i === 0}
              onClick={it.onClick}
            />
          ))}
        </div>
      </>
    )}
  </div>
  );
};

export { TopBar };
