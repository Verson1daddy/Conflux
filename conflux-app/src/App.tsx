import { useEffect, useState } from "react";
import { IslandBar } from "./components/island/IslandBar";
import { Canvas } from "./components/workspace/Canvas";
import { useAgentInstances } from "./hooks/useAgentInstances";
import type { AgentInstanceInfo, AgentStatus } from "./types";

/**
 * Conflux 根组件
 *
 * 根据 Tauri 窗口 label 决定渲染内容：
 * - "island" 窗口 → 灵动岛（无边框透明窗口）
 * - "workspace" 窗口 → 工作台画布
 * - 默认 → 灵动岛（主窗口即为 island）
 */
export default function App() {
  const [windowLabel, setWindowLabel] = useState<string>("island");

  useEffect(() => {
    // Tauri v2: 通过 getCurrentWindow 获取窗口 label
    import("@tauri-apps/api/window").then(({ getCurrentWindow }) => {
      setWindowLabel(getCurrentWindow().label);
    }).catch(() => {
      // 非 Tauri 环境（开发调试时）默认 island
    });
  }, []);

  if (windowLabel === "workspace") {
    return <WorkspaceView />;
  }

  return <IslandBar />;
}

/** 工作台视图——自管理 Agent 数据 */
function WorkspaceView() {
  const { instances, statuses } = useAgentInstances();

  // 将 agentStore Map 格式转为 Canvas 需要的 Map
  const agentMap = new Map<string, AgentInstanceInfo>();
  instances.forEach((info, id) => agentMap.set(id, info));

  const statusMap = new Map<string, AgentStatus>();
  statuses.forEach((status, id) => statusMap.set(id, status));

  return <Canvas agents={agentMap} agentStatuses={statusMap} />;
}
