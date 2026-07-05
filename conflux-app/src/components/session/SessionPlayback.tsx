// ===== SessionPlayback 组件 =====
// 会话回放主容器：深色主题
// 布局：左侧 SessionList（w:300）+ 右侧回放区
// 回放区：Header + Timeline 进度条 + EventList 纵向时间线
// 支持播放/暂停、速度控制（1x/2x/4x）、进度条点击定位

import { useState, useEffect, useCallback, useRef } from "react";
import type { SessionSummary, SessionEvent } from "@/types";
import { listSessions, querySessionEvents } from "@/lib/tauri-bridge";
import {
  hasTerminalOutputEvents,
  summarizeSessionEvent,
} from "@/lib/session-events";
import { SessionList } from "@/components/session/SessionList";
import { Icon } from "@/components/ui/Icon";

// Inlined from deleted hooks/useSessionPlayback.ts
function useSessionPlayback() {
  const [sessions, setSessions] = useState<SessionSummary[]>([]);
  const [selectedSessionId, setSelectedSessionId] = useState<string | null>(null);
  const [events, setEvents] = useState<SessionEvent[]>([]);
  const [currentEventIndex, setCurrentEventIndex] = useState(0);
  const [isPlaying, setIsPlaying] = useState(false);
  const [playbackSpeed, setPlaybackSpeed] = useState(1);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const playStateRef = useRef({ isPlaying, currentEventIndex, playbackSpeed });
  playStateRef.current = { isPlaying, currentEventIndex, playbackSpeed };
  const eventsRef = useRef(events);
  eventsRef.current = events;
  // 最近一次 selectSession 的序号——快速切换会话时丢弃过期查询结果（防串台）。
  const selectReqRef = useRef(0);

  useEffect(() => {
    let cancelled = false;
    async function load() {
      try {
        const result = await listSessions();
        if (!cancelled) setSessions(result);
      } catch {
        // 列表拉取失败：保留已有列表，不炸 UI（下次刷新或重开面板重试）。
      }
    }
    load();
    // 面板开着时轻量刷新（5s）——让 live 会话的时长/事件数不再冻结在打开那一刻。
    const refreshId = window.setInterval(load, 5000);
    return () => {
      cancelled = true;
      window.clearInterval(refreshId);
    };
  }, []);

  useEffect(() => {
    if (!isPlaying || events.length === 0) return;
    const intervalMs = 1000 / playbackSpeed;
    const timerId = window.setInterval(() => {
      const { currentEventIndex: idx } = playStateRef.current;
      if (idx >= eventsRef.current.length - 1) { setIsPlaying(false); return; }
      setCurrentEventIndex(idx + 1);
    }, intervalMs);
    return () => { window.clearInterval(timerId); };
  }, [isPlaying, playbackSpeed, events.length]);

  const selectSession = useCallback(async (instanceId: string) => {
    const reqId = ++selectReqRef.current;
    setSelectedSessionId(instanceId);
    setIsPlaying(false);
    setCurrentEventIndex(0);
    setError(null);
    setLoading(true);
    setEvents([]); // 立即清掉上一会话事件，加载/失败期间不显示旧数据。
    try {
      const sessionEvents = await querySessionEvents(instanceId);
      if (reqId !== selectReqRef.current) return; // 已被更晚的点击取代：丢弃过期结果。
      setEvents(sessionEvents);
    } catch {
      if (reqId !== selectReqRef.current) return;
      setError("加载会话事件失败，请重试");
    } finally {
      if (reqId === selectReqRef.current) setLoading(false);
    }
  }, []);

  const togglePlay = useCallback(() => {
    setIsPlaying((prev) => {
      const { currentEventIndex: idx } = playStateRef.current;
      if (!prev && idx >= eventsRef.current.length - 1 && eventsRef.current.length > 0) {
        setCurrentEventIndex(0);
      }
      return !prev;
    });
  }, []);

  const setSpeed = useCallback((speed: number) => { setPlaybackSpeed(speed); }, []);

  const seekTo = useCallback((index: number) => {
    setCurrentEventIndex(Math.max(0, Math.min(index, events.length - 1)));
  }, [events.length]);

  return { sessions, selectedSessionId, events, currentEventIndex, isPlaying, playbackSpeed, loading, error, selectSession, togglePlay, setSpeed, seekTo };
}

/** 回放速度选项 */
const SPEED_OPTIONS = [1, 2, 4] as const;

/**
 * 事件类型到图标颜色映射
 */
function getEventTypeColor(eventType: string): string {
  switch (eventType) {
    case "AgentStatusChanged":
      return "bg-[#42A5F5]";
    case "PermissionRequested":
      return "bg-[#FFA726]";
    case "SubAgentSpawned":
      return "bg-[#AB47BC]";
    case "SubAgentCompleted":
      return "bg-[#66BB6A]";
    case "TaskCompleted":
      return "bg-[#66BB6A]";
    case "ErrorOccurred":
      return "bg-[#EF5350]";
    case "DiscussionMessage":
      return "bg-[#A8D8EA]";
    case "CoordinationCommand":
      return "bg-[#FFD54F]";
    case "PtyOutput":
      return "bg-[#78909C]";
    case "StdinInjected":
      return "bg-[#CE93D8]";
    default:
      return "bg-[#6B7280]";
  }
}

/**
 * 事件类型到图标标签映射
 */
function getEventTypeLabel(eventType: string): string {
  switch (eventType) {
    case "AgentStatusChanged":
      return "Status";
    case "PermissionRequested":
      return "Permission";
    case "SubAgentSpawned":
      return "Spawn";
    case "SubAgentCompleted":
      return "Complete";
    case "TaskCompleted":
      return "Task Done";
    case "ErrorOccurred":
      return "Error";
    case "DiscussionMessage":
      return "Message";
    case "CoordinationCommand":
      return "Command";
    case "PtyOutput":
      return "Output";
    case "StdinInjected":
      return "Stdin";
    default:
      return eventType;
  }
}

/**
 * 格式化事件时间戳为 HH:mm:ss 格式
 */
function formatEventTime(timestamp: number): string {
  const date = new Date(timestamp);
  const hours = date.getHours().toString().padStart(2, "0");
  const minutes = date.getMinutes().toString().padStart(2, "0");
  const seconds = date.getSeconds().toString().padStart(2, "0");
  return `${hours}:${minutes}:${seconds}`;
}

/** SessionPlayback 组件 */
export function SessionPlayback() {
  const {
    sessions,
    selectedSessionId,
    events,
    currentEventIndex,
    isPlaying,
    playbackSpeed,
    loading,
    error,
    selectSession,
    togglePlay,
    setSpeed,
    seekTo,
  } = useSessionPlayback();

  const timelineRef = useRef<HTMLDivElement>(null);

  // ===== 进度条键盘定位（role=slider + tabIndex=0 需配套键盘处理，否则纯装饰） =====
  const handleTimelineKeyDown = useCallback(
    (e: React.KeyboardEvent<HTMLDivElement>) => {
      if (events.length === 0) return;
      let handled = true;
      switch (e.key) {
        case "ArrowLeft":
        case "ArrowDown":
          seekTo(currentEventIndex - 1);
          break;
        case "ArrowRight":
        case "ArrowUp":
          seekTo(currentEventIndex + 1);
          break;
        case "Home":
          seekTo(0);
          break;
        case "End":
          seekTo(events.length - 1);
          break;
        case "PageDown":
          seekTo(currentEventIndex - 5);
          break;
        case "PageUp":
          seekTo(currentEventIndex + 5);
          break;
        default:
          handled = false;
      }
      if (handled) e.preventDefault();
    },
    [events.length, currentEventIndex, seekTo]
  );

  // ===== Timeline 点击定位 =====
  const handleTimelineClick = useCallback(
    (e: React.MouseEvent<HTMLDivElement>) => {
      const el = timelineRef.current;
      if (!el || events.length === 0) {
        return;
      }
      const rect = el.getBoundingClientRect();
      const ratio = Math.max(0, Math.min(1, (e.clientX - rect.left) / rect.width));
      const targetIndex = Math.round(ratio * (events.length - 1));
      seekTo(targetIndex);
    },
    [events.length, seekTo]
  );

  // 进度百分比
  const progressPercent =
    events.length > 1
      ? (currentEventIndex / (events.length - 1)) * 100
      : 0;
  const hasTerminalEvents = hasTerminalOutputEvents(events);

  return (
    <div className="flex h-full bg-canvas-1">
      {/* ===== 左侧会话列表 ===== */}
      <SessionList
        sessions={sessions}
        selectedId={selectedSessionId}
        onSelect={selectSession}
      />

      {/* ===== 右侧回放区 ===== */}
      <div className="flex-1 flex flex-col min-w-0">
        {/* Header */}
        <div className="flex items-center justify-between px-6 py-4 border-b border-[#2A2A2A]">
          <h2 className="font-display text-xl font-bold text-[#F2F2F2] tracking-tight">
            Session Event Timeline
          </h2>

          {events.length > 0 && (
            <div className="flex items-center gap-3">
              {/* 回放速度选择 */}
              <div className="flex items-center gap-1">
                {SPEED_OPTIONS.map((speed) => (
                  <button
                    key={speed}
                    type="button"
                    onClick={() => setSpeed(speed)}
                    className={`px-2 py-1 text-xs rounded font-mono transition-colors ${
                      playbackSpeed === speed
                        ? "bg-[#A8D8EA] text-[#1A1A1A] font-medium"
                        : "text-[#B8B3B0] hover:text-[#F2F2F2] hover:bg-surface-dark-secondary"
                    }`}
                  >
                    {speed}x
                  </button>
                ))}
              </div>

              {/* 播放/暂停按钮 */}
              <button
                type="button"
                onClick={togglePlay}
                className="flex items-center justify-center w-8 h-8 rounded-lg bg-surface-dark-secondary hover:bg-[#3A3A3A] text-[#F2F2F2] transition-colors"
                aria-label={isPlaying ? "Pause event timeline" : "Start event timeline"}
              >
                {isPlaying ? (
                  <Icon name="pause" size={16} />
                ) : (
                  <Icon name="play" size={16} />
                )}
              </button>
            </div>
          )}
        </div>

        {/* 无选中会话时的空状态 */}
        {!selectedSessionId && (
          <div className="flex-1 flex items-center justify-center">
            <div className="text-center">
              <p className="text-sm text-[#6B7280]">
                Select a session to view recorded events
              </p>
            </div>
          </div>
        )}

        {/* 加载中 */}
        {selectedSessionId && loading && (
          <div className="flex-1 flex items-center justify-center">
            <p className="text-sm text-[#6B7280]">Loading events…</p>
          </div>
        )}

        {/* 加载失败：明确报错，不静默显示上一个会话的事件或假空态 */}
        {selectedSessionId && !loading && error && (
          <div className="flex-1 flex items-center justify-center">
            <div className="text-center">
              <p className="text-sm text-[#EF5350]">{error}</p>
              <button
                type="button"
                onClick={() => void selectSession(selectedSessionId)}
                className="mt-2 text-xs text-[#A8D8EA] hover:underline"
              >
                重试
              </button>
            </div>
          </div>
        )}

        {/* 有选中会话、已加载、无错误但无事件 */}
        {selectedSessionId && !loading && !error && events.length === 0 && (
          <div className="flex-1 flex items-center justify-center">
            <p className="text-sm text-[#6B7280]">
              No events recorded for this session
            </p>
          </div>
        )}

        {/* 有事件时显示 Timeline + EventList */}
        {!loading && !error && events.length > 0 && (
          <>
            {/* ===== Timeline 进度条 ===== */}
            <div className="px-6 py-3 border-b border-[#2A2A2A]">
              {!hasTerminalEvents && (
                <div className="mb-3 rounded-lg border border-[#3A3A3A] bg-surface-dark-secondary/70 px-3 py-2">
                  <p className="text-xs leading-relaxed text-[#B8B3B0]">
                    V1 records a structured event timeline for this session. Full terminal replay is unavailable because no PTY output chunks were recorded.
                  </p>
                </div>
              )}

              <div className="flex items-center gap-3">
                {/* 当前时间 */}
                <span className="text-xs font-mono text-[#B8B3B0] w-16 flex-shrink-0">
                  {events[currentEventIndex]
                    ? formatEventTime(events[currentEventIndex].timestamp)
                    : "--:--:--"}
                </span>

                {/* 进度条 */}
                <div
                  ref={timelineRef}
                  onClick={handleTimelineClick}
                  onKeyDown={handleTimelineKeyDown}
                  className="flex-1 h-2 bg-surface-dark-secondary rounded-full cursor-pointer relative group focus:outline-none focus-visible:ring-2 focus-visible:ring-[#A8D8EA]/50"
                  role="slider"
                  aria-label="Event timeline position"
                  aria-valuemin={0}
                  aria-valuemax={events.length - 1}
                  aria-valuenow={currentEventIndex}
                  tabIndex={0}
                >
                  {/* 已播放进度 */}
                  <div
                    className="absolute inset-y-0 left-0 bg-[#A8D8EA] rounded-full transition-all duration-150"
                    style={{ width: `${progressPercent}%` }}
                  />
                  {/* 拖拽指示器 */}
                  <div
                    className="absolute top-1/2 -translate-y-1/2 w-3 h-3 bg-[#F2F2F2] rounded-full shadow-md opacity-0 group-hover:opacity-100 transition-opacity"
                    style={{ left: `calc(${progressPercent}% - 6px)` }}
                  />
                </div>

                {/* 结束时间 */}
                <span className="text-xs font-mono text-[#6B7280] w-16 text-right flex-shrink-0">
                  {events.length > 0
                    ? formatEventTime(events[events.length - 1].timestamp)
                    : "--:--:--"}
                </span>
              </div>

              {/* 事件计数 */}
              <p className="text-[11px] text-[#6B7280] mt-1">
                Event {currentEventIndex + 1} / {events.length}
              </p>
            </div>

            {/* ===== EventList 纵向时间线 ===== */}
            <div className="flex-1 overflow-y-auto px-6 py-4">
              <div className="relative">
                {/* 纵向连接线 */}
                <div className="absolute left-[7px] top-0 bottom-0 w-px bg-[#2A2A2A]" />

                {events.map((event, index) => {
                  const isCurrent = index === currentEventIndex;
                  const isPast = index < currentEventIndex;

                  return (
                    <button
                      key={event.id}
                      type="button"
                      onClick={() => seekTo(index)}
                      className={`relative flex gap-4 py-2.5 w-full text-left transition-colors ${
                        isCurrent
                          ? "bg-surface-dark-secondary/60 -mx-2 px-2 rounded-lg"
                          : ""
                      }`}
                    >
                      {/* 时间线圆点 */}
                      <div className="flex-shrink-0 relative z-10">
                        <div
                          className={`w-[15px] h-[15px] rounded-full border-2 ${
                            isCurrent
                              ? `${getEventTypeColor(event.event_type)} border-[#F2F2F2] ring-2 ring-[#A8D8EA]/30`
                              : isPast
                                ? `${getEventTypeColor(event.event_type)} border-transparent opacity-70`
                                : "bg-surface-dark border-[#3A3A3A]"
                          }`}
                        />
                      </div>

                      {/* 事件内容 */}
                      <div className="flex-1 min-w-0 -mt-0.5">
                        <div className="flex items-center gap-2 mb-0.5">
                          {/* 时间戳 */}
                          <span
                            className={`text-[11px] font-mono flex-shrink-0 ${
                              isCurrent ? "text-[#A8D8EA]" : "text-[#6B7280]"
                            }`}
                          >
                            {formatEventTime(event.timestamp)}
                          </span>

                          {/* 事件类型标签 */}
                          <span
                            className={`inline-flex items-center px-1.5 py-0.5 rounded text-[10px] font-medium ${
                              isCurrent
                                ? "bg-[#A8D8EA]/20 text-[#A8D8EA]"
                                : isPast
                                  ? "bg-surface-dark-secondary text-[#B8B3B0]"
                                  : "bg-surface-dark-secondary text-[#6B7280]"
                            }`}
                          >
                            {getEventTypeLabel(event.event_type)}
                          </span>
                        </div>

                        {/* 事件摘要 */}
                        <p
                          className={`text-xs leading-relaxed truncate ${
                            isCurrent
                              ? "text-[#F2F2F2]"
                              : isPast
                                ? "text-[#B8B3B0]"
                                : "text-[#6B7280]"
                          }`}
                        >
                          {summarizeSessionEvent(event)}
                        </p>
                      </div>
                    </button>
                  );
                })}
              </div>
            </div>
          </>
        )}
      </div>
    </div>
  );
}
