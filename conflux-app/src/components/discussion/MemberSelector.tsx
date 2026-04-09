// ===== MemberSelector 组件 =====
// 创建讨论时选择参与 Agent 的多选列表
// 显示所有活跃 Agent：名称 + adapter + 状态点
// 选中态：冰蓝色边框 + 背景高亮

import { useState, useEffect } from "react";
import type { InstanceId, AgentInstanceInfo } from "@/types";
import { listAgentInstances } from "@/lib/tauri-bridge";

/** MemberSelector 组件 Props */
interface MemberSelectorProps {
  /** 已选中的 Agent 实例 ID 列表 */
  selected: InstanceId[];
  /** 选中状态变更回调 */
  onSelectionChange: (ids: InstanceId[]) => void;
}

/**
 * Agent 状态对应的状态点颜色
 */
function getStatusDotColor(status: AgentInstanceInfo["status"]): string {
  switch (status) {
    case "idle":
      return "bg-[#9E9E9E]";
    case "thinking":
      return "bg-[#FFA726]";
    case "coding":
      return "bg-[#42A5F5]";
    case "waiting_permission":
      return "bg-[#EF5350]";
    case "done":
      return "bg-[#66BB6A]";
    case "error":
      return "bg-[#EF5350]";
  }
}

/**
 * Agent 状态的中文显示标签
 */
function getStatusLabel(status: AgentInstanceInfo["status"]): string {
  switch (status) {
    case "idle":
      return "Idle";
    case "thinking":
      return "Thinking";
    case "coding":
      return "Coding";
    case "waiting_permission":
      return "Waiting";
    case "done":
      return "Done";
    case "error":
      return "Error";
  }
}

/** MemberSelector 组件 */
export function MemberSelector({
  selected,
  onSelectionChange,
}: MemberSelectorProps) {
  const [agents, setAgents] = useState<AgentInstanceInfo[]>([]);
  const [loading, setLoading] = useState(true);

  // 加载活跃 Agent 列表
  useEffect(() => {
    let cancelled = false;

    async function loadAgents() {
      setLoading(true);
      const instances = await listAgentInstances();
      if (!cancelled) {
        setAgents(instances);
        setLoading(false);
      }
    }

    loadAgents();
    return () => {
      cancelled = true;
    };
  }, []);

  /**
   * 切换某个 Agent 的选中状态
   */
  function handleToggle(instanceId: InstanceId) {
    const isSelected = selected.includes(instanceId);
    if (isSelected) {
      onSelectionChange(selected.filter((id) => id !== instanceId));
    } else {
      onSelectionChange([...selected, instanceId]);
    }
  }

  if (loading) {
    return (
      <div className="py-6 text-center text-sm text-[#8A8A8A]">
        Loading agents...
      </div>
    );
  }

  if (agents.length === 0) {
    return (
      <div className="py-6 text-center text-sm text-[#8A8A8A]">
        No active agents available
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-2">
      {agents.map((agent) => {
        const isSelected = selected.includes(agent.instance_id);

        return (
          <button
            key={agent.instance_id}
            type="button"
            onClick={() => handleToggle(agent.instance_id)}
            className={`flex items-center gap-3 px-3 py-2.5 rounded-lg border transition-colors text-left ${
              isSelected
                ? "border-[#A8D8EA] bg-[#F0F8FF]"
                : "border-[#D4CFC9] bg-white hover:bg-[#FAF8F5]"
            }`}
          >
            {/* 选中指示器 */}
            <div
              className={`flex-shrink-0 w-4 h-4 rounded border-2 flex items-center justify-center transition-colors ${
                isSelected
                  ? "border-[#A8D8EA] bg-[#A8D8EA]"
                  : "border-[#D4CFC9]"
              }`}
            >
              {isSelected && (
                <svg
                  width="10"
                  height="8"
                  viewBox="0 0 10 8"
                  fill="none"
                  className="text-white"
                >
                  <path
                    d="M1 4L3.5 6.5L9 1"
                    stroke="currentColor"
                    strokeWidth="1.5"
                    strokeLinecap="round"
                    strokeLinejoin="round"
                  />
                </svg>
              )}
            </div>

            {/* Agent 信息 */}
            <div className="flex-1 min-w-0">
              <div className="flex items-center gap-2">
                <span className="text-sm font-medium text-[#2C2C2C] truncate">
                  {agent.adapter_name}
                </span>
                <span className="text-xs text-[#8A8A8A] truncate">
                  {agent.instance_id.slice(0, 8)}
                </span>
              </div>
            </div>

            {/* 状态点 + 状态标签 */}
            <div className="flex items-center gap-1.5 flex-shrink-0">
              <div
                className={`w-2 h-2 rounded-full ${getStatusDotColor(agent.status)}`}
              />
              <span className="text-xs text-[#8A8A8A]">
                {getStatusLabel(agent.status)}
              </span>
            </div>
          </button>
        );
      })}
    </div>
  );
}
