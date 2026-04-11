// ===== StatusBar 组件 =====
// 底部状态栏 h:30, glass-bg + backdrop-blur
// 设计稿: activity图标 + agent状态摘要 | spacer | 版本号

import { type FC, useEffect, useState } from "react";
import { listAgentInstances } from "@/lib/tauri-bridge";
import { onAgentStatusChanged } from "@/lib/event-listener";
import type { AgentInstanceInfo } from "@/types";

const StatusBar: FC = () => {
  const [agents, setAgents] = useState<AgentInstanceInfo[]>([]);

  const fetchAgents = async () => {
    try {
      const list = await listAgentInstances();
      setAgents(list);
    } catch { /* 后端不可用 */ }
  };

  useEffect(() => { fetchAgents(); }, []);

  useEffect(() => {
    let unlisten: (() => void) | undefined;
    onAgentStatusChanged(() => fetchAgents()).then((fn) => { unlisten = fn; });
    return () => { unlisten?.(); };
  }, []);

  // 构建状态摘要文字
  const statusSummary = agents.length > 0
    ? agents.map((a) => `${a.adapter_name}: ${a.status}`).join(" · ")
    : "No active agents";

  return (
    <footer
      className="flex items-center h-[30px] px-6 shrink-0 gap-3"
      style={{
        background: "rgba(255,255,255,0.04)",
        backdropFilter: "blur(16px)",
        WebkitBackdropFilter: "blur(16px)",
        borderTop: "1px solid rgba(255,255,255,0.08)",
      }}
    >
      {/* Activity 图标 */}
      <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="#B8D4E3" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
        <path d="M22 12h-2.48a2 2 0 0 0-1.93 1.46l-2.35 8.36a.25.25 0 0 1-.48 0L9.24 2.18a.25.25 0 0 0-.48 0l-2.35 8.36A2 2 0 0 1 4.49 12H2" />
      </svg>

      {/* Agent 状态摘要 */}
      <span className="text-[#6B7280] text-[10px] font-body truncate">
        {statusSummary}
      </span>

      {/* Spacer */}
      <div className="flex-1" />

      {/* 版本号 */}
      <span className="text-[#6B7280] text-[10px] font-body shrink-0">
        Conflux v0.1.0-alpha · Windows 11
      </span>
    </footer>
  );
};

export { StatusBar };
