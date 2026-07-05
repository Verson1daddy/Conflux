import { type FC } from "react";
import { buildStatusSummary } from "@/lib/workspace-status";
import { useAgentStore } from "@/stores/agentStore";
import { Icon } from "@/components/ui/Icon";

interface StatusBarProps {
  onOpenSession?: () => void;
}

const StatusBar: FC<StatusBarProps> = ({ onOpenSession }) => {
  // 批3 §3：摘要是 string——selector 直接派生 primitive，仅文案变化时重渲染，
  // 不再订阅整张 instances Map。
  const statusSummary = useAgentStore((s) => buildStatusSummary(s.instances));

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
      <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="#B8D4E3" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
        <path d="M22 12h-2.48a2 2 0 0 0-1.93 1.46l-2.35 8.36a.25.25 0 0 1-.48 0L9.24 2.18a.25.25 0 0 0-.48 0l-2.35 8.36A2 2 0 0 1 4.49 12H2" />
      </svg>

      <span className="text-[#6B7280] text-[10px] font-body truncate">
        {statusSummary}
      </span>

      {onOpenSession && (
        <button
          onClick={onOpenSession}
          className="flex items-center gap-1 px-2 py-0.5 rounded text-[#6B7280] hover:text-[#B8D4E3] hover:bg-[#2A2A2A] transition-colors shrink-0"
          title="Session event timeline"
          aria-label="Open session event timeline"
        >
          <Icon name="clock" size={11} />
          <span className="text-[10px] font-body">Session</span>
        </button>
      )}

      <div className="flex-1" />

      <span className="text-[#6B7280] text-[10px] font-body shrink-0">
        Conflux v0.1.1-alpha - Windows 11
      </span>
    </footer>
  );
};

export { StatusBar };
