// ===== SessionList 组件 =====
// 会话列表侧边栏：深色背景，宽 300px
// 每个 session card: adapter 名 + 工作目录 + 开始/结束时间 + 事件数量
// 选中态高亮

import type { SessionSummary } from "@/types";

/** SessionList 组件 Props */
interface SessionListProps {
  /** 会话摘要列表 */
  sessions: SessionSummary[];
  /** 当前选中的会话实例 ID */
  selectedId: string | null;
  /** 选中会话回调 */
  onSelect: (id: string) => void;
}

/**
 * 格式化时间戳为简短日期时间格式
 */
function formatDateTime(timestamp: number): string {
  const date = new Date(timestamp);
  const month = (date.getMonth() + 1).toString().padStart(2, "0");
  const day = date.getDate().toString().padStart(2, "0");
  const hours = date.getHours().toString().padStart(2, "0");
  const minutes = date.getMinutes().toString().padStart(2, "0");
  return `${month}-${day} ${hours}:${minutes}`;
}

/**
 * 格式化持续时间
 */
function formatDuration(startedAt: number, endedAt: number | null): string {
  const end = endedAt ?? Date.now();
  const durationMs = end - startedAt;
  const minutes = Math.floor(durationMs / 60000);
  const hours = Math.floor(minutes / 60);

  if (hours > 0) {
    return `${hours}h ${minutes % 60}m`;
  }
  if (minutes > 0) {
    return `${minutes}m`;
  }
  return "<1m";
}

/**
 * 截断工作目录路径，只显示最后两级
 */
function shortenPath(fullPath: string): string {
  const parts = fullPath.replace(/\\/g, "/").split("/").filter(Boolean);
  if (parts.length <= 2) {
    return fullPath;
  }
  return `.../${parts.slice(-2).join("/")}`;
}

/** SessionList 组件 */
export function SessionList({
  sessions,
  selectedId,
  onSelect,
}: SessionListProps) {
  if (sessions.length === 0) {
    return (
      <div className="flex flex-col w-[300px] h-full bg-surface-dark border-r border-[#2A2A2A]">
        <div className="px-4 py-4 border-b border-[#2A2A2A]">
          <h3 className="font-display text-lg font-bold text-[#F2F2F2]">
            Sessions
          </h3>
        </div>
        <div className="flex items-center justify-center flex-1">
          <p className="text-sm text-[#6B7280]">No sessions recorded</p>
        </div>
      </div>
    );
  }

  return (
    <div className="flex flex-col w-[300px] h-full bg-surface-dark border-r border-[#2A2A2A]">
      {/* 标题 */}
      <div className="px-4 py-4 border-b border-[#2A2A2A]">
        <h3 className="font-display text-lg font-bold text-[#F2F2F2]">
          Sessions
        </h3>
        <p className="text-xs text-[#6B7280] mt-1">
          {sessions.length} session{sessions.length !== 1 ? "s" : ""} recorded
        </p>
      </div>

      {/* 会话卡片列表 */}
      <div className="flex-1 overflow-y-auto py-2">
        {sessions.map((session) => {
          const isSelected = selectedId === session.instance_id;

          return (
            <button
              key={session.instance_id}
              type="button"
              onClick={() => onSelect(session.instance_id)}
              className={`w-full text-left px-4 py-3 transition-colors ${
                isSelected
                  ? "bg-surface-dark-secondary border-l-2 border-l-[#A8D8EA]"
                  : "hover:bg-surface-dark-secondary/50 border-l-2 border-l-transparent"
              }`}
            >
              {/* Adapter 名 + 运行状态 */}
              <div className="flex items-center justify-between mb-1">
                <span className="text-sm font-medium text-[#F2F2F2] truncate">
                  {session.adapter_name}
                </span>
                {session.ended_at === null && (
                  <span className="flex-shrink-0 inline-flex items-center gap-1 text-[10px] text-[#66BB6A]">
                    <span className="w-1.5 h-1.5 rounded-full bg-[#66BB6A] animate-pulse" />
                    Live
                  </span>
                )}
              </div>

              {/* 工作目录 */}
              <p className="text-xs text-[#B8B3B0] truncate font-mono mb-1.5">
                {shortenPath(session.working_dir)}
              </p>

              {/* 时间 + 事件数量 */}
              <div className="flex items-center gap-2 text-[11px] text-[#6B7280]">
                <span>{formatDateTime(session.started_at)}</span>
                <span>&middot;</span>
                <span>{formatDuration(session.started_at, session.ended_at)}</span>
                <span>&middot;</span>
                <span>{session.event_count} events</span>
              </div>
            </button>
          );
        })}
      </div>
    </div>
  );
}
