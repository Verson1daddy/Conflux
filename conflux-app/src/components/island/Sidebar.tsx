// ===== Sidebar 组件 =====
// 侧边栏态灵动岛
// 宽 420px 暗色毛玻璃面板，从右侧滑入
// 头部：Conflux logo + 收起按钮
// 主体：AGENTS 区域 + NOTIFICATIONS 区域
// 底部：权限请求操作区

import { type FC, useEffect, useState, useCallback } from "react";
import { StatusCapsule } from "./StatusCapsule";
import { NotificationQueue } from "./NotificationQueue";
import { PermissionDialog } from "./PermissionDialog";
import { useIslandStore } from "@/stores/islandStore";
import { listAgentInstances, focusAgentCard } from "@/lib/tauri-bridge";
import { onAgentStatusChanged } from "@/lib/event-listener";
import type { AgentInstanceInfo, PermissionRequest } from "@/types";

interface SidebarProps {
  /** 是否可见（控制滑入/滑出动画） */
  visible: boolean;
  /** 收起回调（回到胶囊态） */
  onCollapse: () => void;
}

/**
 * Sidebar — 侧边栏态灵动岛
 *
 * - 宽 420px, 暗色毛玻璃面板
 * - 头部：Conflux logo + 收起按钮
 * - AGENTS 区域：Agent 列表（名称 + 状态点 + adapter 名）
 * - NOTIFICATIONS 区域：通知队列
 * - 底部：权限请求操作区（点击打开 PermissionDialog）
 * - 从右侧滑入，300ms ease transition
 */
const Sidebar: FC<SidebarProps> = ({ visible, onCollapse }) => {
  const pendingPermissions = useIslandStore((s) => s.pendingPermissions);

  // Agent 实例列表
  const [agents, setAgents] = useState<AgentInstanceInfo[]>([]);

  // 当前打开的权限弹窗
  const [activePermission, setActivePermission] =
    useState<PermissionRequest | null>(null);

  // 获取 Agent 列表
  const fetchAgents = useCallback(async () => {
    try {
      const list = await listAgentInstances();
      setAgents(list);
    } catch {
      // 后端不可用时保持空列表
    }
  }, []);

  // 初始化获取 Agent 列表
  useEffect(() => {
    fetchAgents();
  }, [fetchAgents]);

  // 监听状态变化刷新 Agent 列表
  useEffect(() => {
    let unlisten: (() => void) | undefined;
    onAgentStatusChanged(() => {
      fetchAgents();
    }).then((fn) => {
      unlisten = fn;
    });
    return () => {
      unlisten?.();
    };
  }, [fetchAgents]);

  // 点击 Agent 聚焦到工作台卡片
  const handleAgentClick = useCallback(
    async (instanceId: string) => {
      try {
        await focusAgentCard(instanceId);
      } catch {
        // 忽略聚焦失败
      }
    },
    []
  );

  // 打开权限审批弹窗
  const handlePermissionClick = useCallback(
    (request: PermissionRequest) => {
      setActivePermission(request);
    },
    []
  );

  // 关闭权限审批弹窗
  const handlePermissionClose = useCallback(() => {
    setActivePermission(null);
  }, []);

  return (
    <>
      {/* 背景遮罩（点击收起） */}
      <div
        className={`
          fixed inset-0 z-30 bg-black/20 backdrop-blur-sm
          transition-opacity duration-300
          ${visible ? "opacity-100 pointer-events-auto" : "opacity-0 pointer-events-none"}
        `}
        onClick={onCollapse}
        aria-hidden="true"
      />

      {/* 侧边栏面板 */}
      <div
        className={`
          fixed top-0 right-0 z-40 h-full w-[420px]
          bg-surface-dark/90 backdrop-blur-xl
          border-l border-white/5
          shadow-elevated
          transition-transform duration-300 ease-in-out
          ${visible ? "translate-x-0" : "translate-x-full"}
          flex flex-col overflow-hidden
        `}
        role="complementary"
        aria-label="Island sidebar"
      >
        {/* ===== 头部 ===== */}
        <div className="flex items-center justify-between px-5 py-4 border-b border-white/5">
          <div className="flex items-center gap-2.5">
            {/* Conflux logo 占位 */}
            <div className="w-7 h-7 rounded-lg bg-island-bg flex items-center justify-center shadow-island-glow">
              <span className="text-xs font-display font-bold text-accent-glow">
                C
              </span>
            </div>
            <span className="text-sm font-display font-semibold text-white tracking-wide">
              Conflux
            </span>
          </div>

          {/* 收起按钮 */}
          <button
            className="w-8 h-8 rounded-lg flex items-center justify-center
              text-white/40 hover:text-white/80 hover:bg-white/5
              transition-colors duration-200"
            onClick={onCollapse}
            aria-label="Collapse sidebar"
          >
            <svg
              width="16"
              height="16"
              viewBox="0 0 16 16"
              fill="none"
              xmlns="http://www.w3.org/2000/svg"
            >
              <path
                d="M6 3L11 8L6 13"
                stroke="currentColor"
                strokeWidth="1.5"
                strokeLinecap="round"
                strokeLinejoin="round"
              />
            </svg>
          </button>
        </div>

        {/* ===== 主体滚动区 ===== */}
        <div className="flex-1 overflow-y-auto">
          {/* AGENTS 区域 */}
          <div className="px-5 pt-4 pb-2">
            <p className="text-[10px] font-mono text-white/30 uppercase tracking-widest mb-3">
              Agents
            </p>

            {agents.length === 0 ? (
              <p className="text-xs font-body text-white/20 py-3">
                No active agents
              </p>
            ) : (
              <div className="flex flex-col gap-1">
                {agents.map((agent) => (
                  <button
                    key={agent.instance_id}
                    className="flex items-center gap-3 px-3 py-2.5 rounded-lg
                      hover:bg-white/5 transition-colors duration-200
                      text-left w-full group"
                    onClick={() => handleAgentClick(agent.instance_id)}
                    aria-label={`Focus agent ${agent.adapter_name}, status: ${agent.status}`}
                  >
                    {/* Agent 名称 + adapter */}
                    <div className="flex-1 min-w-0">
                      <p className="text-xs font-body text-white/80 truncate group-hover:text-white transition-colors">
                        {agent.adapter_name}
                      </p>
                      <p className="text-[10px] font-mono text-white/30 truncate">
                        {agent.instance_id.slice(0, 8)}...
                      </p>
                    </div>

                    {/* 状态胶囊 */}
                    <StatusCapsule status={agent.status} />

                    {/* 主框架标记 */}
                    {agent.is_primary_framework && (
                      <span className="text-[9px] font-mono text-accent-glow bg-accent-glow/10 px-1.5 py-0.5 rounded">
                        PRIMARY
                      </span>
                    )}
                  </button>
                ))}
              </div>
            )}
          </div>

          {/* 分隔线 */}
          <div className="mx-5 border-t border-white/5" />

          {/* NOTIFICATIONS 区域 */}
          <div className="px-5 pt-4 pb-2">
            <p className="text-[10px] font-mono text-white/30 uppercase tracking-widest mb-3">
              Notifications
            </p>
            <NotificationQueue />
          </div>
        </div>

        {/* ===== 底部：权限请求操作区 ===== */}
        {pendingPermissions.length > 0 && (
          <div className="px-5 py-3 border-t border-white/5 bg-surface-dark/80">
            <p className="text-[10px] font-mono text-yellow-400 uppercase tracking-widest mb-2">
              Pending Approvals ({pendingPermissions.length})
            </p>
            <div className="flex flex-col gap-1.5">
              {pendingPermissions.map((perm) => (
                <button
                  key={perm.id}
                  className="flex items-center gap-2 px-3 py-2 rounded-lg
                    bg-yellow-500/5 border border-yellow-500/15
                    hover:bg-yellow-500/10 transition-colors duration-200
                    text-left w-full"
                  onClick={() => handlePermissionClick(perm)}
                  aria-label={`Review permission: ${perm.action}`}
                >
                  <span className="text-yellow-400 text-sm animate-pulse">
                    {"\uD83D\uDD12"}
                  </span>
                  <div className="flex-1 min-w-0">
                    <p className="text-xs font-body text-white/70 truncate">
                      {perm.action}
                    </p>
                    <p className="text-[10px] font-mono text-white/30 truncate">
                      {perm.instance_id}
                    </p>
                  </div>
                  <span className="text-[10px] font-mono text-yellow-400/60">
                    Review
                  </span>
                </button>
              ))}
            </div>
          </div>
        )}
      </div>

      {/* 权限审批弹窗 */}
      {activePermission && (
        <PermissionDialog
          request={activePermission}
          onClose={handlePermissionClose}
        />
      )}
    </>
  );
};

export { Sidebar };
