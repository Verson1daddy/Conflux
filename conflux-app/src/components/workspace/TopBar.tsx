// ===== TopBar 组件 =====
// 工作台顶部栏 h:52, glass-bg + backdrop-blur
// 设计稿结构: addBtn | spacer | island capsule (260px) | spacer | search | settings
//
// Capsule 有三种态（按优先级）：
//   1. permission — pending permission request，琥珀 glow
//   2. notification — 有未读通知，琥珀 glow + pulse + badge + 动态消息轮播
//   3. normal — 显示活跃 agent 数量
// 胶囊 hover 时右侧出现 ✎ 铅笔（Send to... 主动发起入口）

import { type FC, useEffect, useMemo, useState } from "react";
import { useIslandStore } from "@/stores/islandStore";
import { useAgentStore } from "@/stores/agentStore";
import { listAgentInstances } from "@/lib/tauri-bridge";
import { onAgentStatusChanged } from "@/lib/event-listener";
import type { AgentStatus } from "@/types";

interface TopBarProps {
  onIslandClick: () => void;
  onTrayOpen: () => void;
  onSendToOpen: () => void;
  onAddAgent: () => void;
  onSearch: () => void;
  onSettings: () => void;
}

const TopBar: FC<TopBarProps> = ({ onIslandClick, onTrayOpen, onSendToOpen, onAddAgent, onSearch, onSettings }) => {
  const pendingPermissions = useIslandStore((s) => s.pendingPermissions);
  const notifications = useIslandStore((s) => s.notifications);
  const instances = useAgentStore((s) => s.instances);
  const [activeCount, setActiveCount] = useState(0);
  const [primaryStatus, setPrimaryStatus] = useState<AgentStatus>("idle");
  const [capsuleHover, setCapsuleHover] = useState(false);

  // 从 agentStore 找到 pinned primary，没有则 fallback 到 "Conflux" 品牌名
  const primaryLabel = useMemo(() => {
    for (const inst of instances.values()) {
      if (inst.is_primary_framework) return inst.adapter_name;
    }
    return "Conflux";
  }, [instances]);

  // 获取 Agent 列表
  const fetchAgents = async () => {
    try {
      const agents = await listAgentInstances();
      setActiveCount(agents.length);
      const primary = agents.find((a) => a.is_primary_framework);
      if (primary) setPrimaryStatus(primary.status);
    } catch { /* 后端不可用 */ }
  };

  useEffect(() => { fetchAgents(); }, []);

  useEffect(() => {
    let unlisten: (() => void) | undefined;
    onAgentStatusChanged(() => fetchAgents()).then((fn) => { unlisten = fn; });
    return () => { unlisten?.(); };
  }, []);

  const isActive = primaryStatus === "thinking" || primaryStatus === "coding";
  const hasPermission = pendingPermissions.length > 0;
  const hasNotification = notifications.length > 0;

  // 胶囊状态优先级：permission > notification > active > idle
  const capsuleState: "permission" | "notification" | "active" | "idle" =
    hasPermission
      ? "permission"
      : hasNotification
        ? "notification"
        : isActive || activeCount > 0
          ? "active"
          : "idle";

  // 胶囊发光
  const glowStyle =
    capsuleState === "permission" || capsuleState === "notification"
      ? "0 0 20px rgba(255,184,0,0.32), 0 1px 3px rgba(0,0,0,0.4)"
      : capsuleState === "active"
        ? "0 0 20px rgba(184,212,227,0.31), 0 1px 3px rgba(0,0,0,0.4)"
        : "0 1px 3px rgba(0,0,0,0.4)";

  // 状态点颜色
  const dotColor =
    capsuleState === "permission" || capsuleState === "notification"
      ? "bg-[#FFB800]"
      : capsuleState === "active"
        ? "bg-[#34C759]"
        : "bg-[#6B7280]";

  // 胶囊主文字
  const capsuleText =
    capsuleState === "permission"
      ? "Approval Needed"
      : capsuleState === "notification"
        ? `${notifications[0]?.source_adapter_name || "Agent"} · task done`
        : activeCount > 0
          ? `${activeCount} Agent${activeCount > 1 ? "s" : ""} Active`
          : "No Agents";

  // 胶囊 click 行为：通知态 → tray；其他 → sidebar
  const handleCapsuleClick = () => {
    if (capsuleState === "notification") {
      onTrayOpen();
    } else {
      onIslandClick();
    }
  };

  // hover 态下 ✎ 铅笔的 click：主动发起 Send to... 面板（和通知无关）
  const handlePencilClick = (e: React.MouseEvent) => {
    e.stopPropagation();
    onSendToOpen();
  };

  // layers 图标 click：独立 Sidebar 入口
  // Why: notification 态下胶囊主体打开 tray，但用户仍需快速进 Sidebar 查看
  // agent 详情。layers 图标承担"永远进 Sidebar"的入口，与 tray 入口解耦。
  const handleLayersClick = (e: React.MouseEvent) => {
    e.stopPropagation();
    onIslandClick();
  };

  return (
    <header
      className="flex items-center h-[52px] px-5 shrink-0 relative z-30"
      style={{
        background: "rgba(255,255,255,0.04)",
        backdropFilter: "blur(24px)",
        WebkitBackdropFilter: "blur(24px)",
        borderBottom: "1px solid rgba(255,255,255,0.08)",
      }}
    >
      {/* 左侧: Add Agent */}
      <button
        className="flex items-center gap-[5px] px-[10px] py-[5px] rounded-lg
          text-xs font-body text-[#B8B3B0] font-medium
          hover:bg-[rgba(255,255,255,0.07)] transition-colors duration-200"
        style={{
          background: "rgba(255,255,255,0.07)",
          border: "1px solid rgba(255,255,255,0.08)",
        }}
        onClick={onAddAgent}
        title="Add new agent instance"
      >
        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="#B8D4E3" strokeWidth="2" strokeLinecap="round">
          <path d="M12 5v14M5 12h14" />
        </svg>
        <span>Add Agent</span>
      </button>

      {/* Spacer */}
      <div className="flex-1" />

      {/* 中间: 灵动岛胶囊 — 严格按设计稿 */}
      <button
        className={`flex items-center gap-2 h-[34px] pl-2 pr-4 rounded-full cursor-pointer select-none
          transition-shadow duration-300 hover:border-white/20
          ${capsuleState === "notification" ? "capsule-pulse" : ""}`}
        style={{
          background: "#000000",
          boxShadow: glowStyle,
          minWidth: "260px",
          justifyContent: "center",
          border:
            capsuleState === "notification" || capsuleState === "permission"
              ? "1px solid rgba(255,184,0,0.3)"
              : "1px solid rgba(255,255,255,0.07)",
        }}
        onClick={handleCapsuleClick}
        onMouseEnter={() => setCapsuleHover(true)}
        onMouseLeave={() => setCapsuleHover(false)}
        aria-label={`Dynamic island: ${capsuleText}. Click to ${capsuleState === "notification" ? "open notifications" : "expand sidebar"}.`}
      >
        {/* Unread 数字 badge — 仅 notification 态 */}
        {capsuleState === "notification" && (
          <span
            className="shrink-0 flex items-center justify-center"
            style={{
              width: 20,
              height: 20,
              borderRadius: 9999,
              background: "#FFB800",
              fontFamily: "'Geist Sans', sans-serif",
              fontSize: 11,
              fontWeight: 700,
              color: "#0A0F15",
              marginLeft: 2,
            }}
          >
            {notifications.length}
          </span>
        )}

        {/* 状态点 — 非 notification 态 */}
        {capsuleState !== "notification" && (
          <span className={`w-[6px] h-[6px] rounded-full shrink-0 ${dotColor} ml-2`} />
        )}

        {/* 状态文字 */}
        <span className="text-white text-xs font-medium tracking-wide font-body truncate max-w-[200px]">
          {capsuleText}
        </span>

        {/* 分隔线 */}
        <span className="w-px h-4 bg-white/10 shrink-0" />

        {/* Layers 图标 — 独立 Sidebar 入口（notification 态下仍可直接进 Sidebar） */}
        <span
          role="button"
          aria-label="Open sidebar"
          title="Open sidebar"
          onClick={handleLayersClick}
          className="shrink-0 flex items-center justify-center transition-opacity hover:opacity-80"
          style={{ cursor: "pointer" }}
        >
          <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="#B8D4E3" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <path d="m12.83 2.18a2 2 0 0 0-1.66 0L2.6 6.08a1 1 0 0 0 0 1.83l8.58 3.91a2 2 0 0 0 1.66 0l8.58-3.9a1 1 0 0 0 0-1.83Z" />
            <path d="m22 12-8.58 3.91a2 2 0 0 1-1.66 0L3.18 12" opacity="0.6" />
            <path d="m22 17-8.58 3.91a2 2 0 0 1-1.66 0L3.18 17" opacity="0.3" />
          </svg>
        </span>

        {/* 品牌名 / Primary agent 名（跟随 pin 状态） */}
        <span
          className="text-[#B8D4E3] text-[11px] font-semibold tracking-wider font-body truncate max-w-[120px]"
          title={primaryLabel === "Conflux" ? "No primary agent pinned" : `Primary: ${primaryLabel}`}
        >
          {primaryLabel}
        </span>

        {/* Hover ✎ 铅笔 — 主动发起 Send to... */}
        <span
          role="button"
          aria-label="Send to primary agent"
          onClick={handlePencilClick}
          className="shrink-0 flex items-center justify-center transition-opacity"
          style={{
            width: 20,
            height: 20,
            marginLeft: 4,
            opacity: capsuleHover ? 1 : 0,
            color: "#B8B3B0",
            cursor: "pointer",
          }}
        >
          <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <path d="M21.174 6.812a1 1 0 0 0-3.986-3.987L3.842 16.174a2 2 0 0 0-.5.83l-1.321 4.352a.5.5 0 0 0 .623.622l4.353-1.32a2 2 0 0 0 .83-.497z" />
            <path d="m15 5 4 4" />
          </svg>
        </span>
      </button>

      {/* Spacer */}
      <div className="flex-1" />

      {/* 右侧: 通知 + 搜索 + 设置 */}
      <div className="flex items-center gap-[10px]">
        {/* Bell — 独立 Notifications tray 入口（可查看空态 / 通知历史） */}
        <button
          className={`relative transition-colors ${
            hasNotification ? "text-[#FFB800]" : "text-[#6B7280] hover:text-[#B8B3B0]"
          }`}
          onClick={onTrayOpen}
          title={hasNotification ? `${notifications.length} notification${notifications.length > 1 ? "s" : ""}` : "Notifications"}
          aria-label="Open notifications tray"
        >
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <path d="M10.268 21a2 2 0 0 0 3.464 0" />
            <path d="M3.262 15.326A1 1 0 0 0 4 17h16a1 1 0 0 0 .74-1.673C19.41 13.956 18 12.499 18 8A6 6 0 0 0 6 8c0 4.499-1.411 5.956-2.738 7.326" />
          </svg>
          {hasNotification && (
            <span
              aria-hidden="true"
              className="absolute -top-[2px] -right-[2px] rounded-full"
              style={{ width: 7, height: 7, background: "#FFB800", boxShadow: "0 0 0 1.5px rgba(10,15,21,0.9)" }}
            />
          )}
        </button>
        <button
          className="text-[#6B7280] hover:text-[#B8B3B0] transition-colors"
          onClick={onSearch}
          title="Search (⌘K)"
        >
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
            <circle cx="11" cy="11" r="8" />
            <path d="m21 21-4.3-4.3" />
          </svg>
        </button>
        <button
          className="text-[#6B7280] hover:text-[#B8B3B0] transition-colors"
          onClick={onSettings}
          title="Settings"
        >
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
            <path d="M12.22 2h-.44a2 2 0 0 0-2 2v.18a2 2 0 0 1-1 1.73l-.43.25a2 2 0 0 1-2 0l-.15-.08a2 2 0 0 0-2.73.73l-.22.38a2 2 0 0 0 .73 2.73l.15.1a2 2 0 0 1 1 1.72v.51a2 2 0 0 1-1 1.74l-.15.09a2 2 0 0 0-.73 2.73l.22.38a2 2 0 0 0 2.73.73l.15-.08a2 2 0 0 1 2 0l.43.25a2 2 0 0 1 1 1.73V20a2 2 0 0 0 2 2h.44a2 2 0 0 0 2-2v-.18a2 2 0 0 1 1-1.73l.43-.25a2 2 0 0 1 2 0l.15.08a2 2 0 0 0 2.73-.73l.22-.39a2 2 0 0 0-.73-2.73l-.15-.08a2 2 0 0 1-1-1.74v-.5a2 2 0 0 1 1-1.74l.15-.09a2 2 0 0 0 .73-2.73l-.22-.38a2 2 0 0 0-2.73-.73l-.15.08a2 2 0 0 1-2 0l-.43-.25a2 2 0 0 1-1-1.73V4a2 2 0 0 0-2-2z" />
            <circle cx="12" cy="12" r="3" />
          </svg>
        </button>
      </div>
    </header>
  );
};

export { TopBar };
