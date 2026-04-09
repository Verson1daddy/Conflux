// ===== useSessionPlayback Hook =====
// 会话回放业务逻辑：加载会话列表、选择会话加载事件、回放控制（播放/暂停/速度/定位）

import { useState, useEffect, useCallback, useRef } from "react";
import type { SessionSummary, SessionEvent } from "@/types";
import { listSessions, querySessionEvents } from "@/lib/tauri-bridge";

/**
 * 会话回放核心 hook
 *
 * 功能：
 * - 加载会话列表
 * - 选择会话后加载事件流
 * - 回放逻辑：setInterval 按 playbackSpeed 推进 currentEventIndex
 * - 支持 1x/2x/4x 回放速度
 * - 支持 seekTo 定位到指定事件索引
 */
export function useSessionPlayback() {
  const [sessions, setSessions] = useState<SessionSummary[]>([]);
  const [selectedSessionId, setSelectedSessionId] = useState<string | null>(
    null
  );
  const [events, setEvents] = useState<SessionEvent[]>([]);
  const [currentEventIndex, setCurrentEventIndex] = useState(0);
  const [isPlaying, setIsPlaying] = useState(false);
  const [playbackSpeed, setPlaybackSpeed] = useState(1);

  // 用 ref 追踪回放状态，避免 setInterval 闭包过时
  const playStateRef = useRef({ isPlaying, currentEventIndex, playbackSpeed });
  playStateRef.current = { isPlaying, currentEventIndex, playbackSpeed };

  const eventsRef = useRef(events);
  eventsRef.current = events;

  // ===== 初始化：加载会话列表 =====
  useEffect(() => {
    let cancelled = false;

    async function loadSessions() {
      const result = await listSessions();
      if (!cancelled) {
        setSessions(result);
      }
    }

    loadSessions();
    return () => {
      cancelled = true;
    };
  }, []);

  // ===== 回放定时器 =====
  useEffect(() => {
    if (!isPlaying || events.length === 0) {
      return;
    }

    // 基础间隔 1000ms，按速度缩放
    const intervalMs = 1000 / playbackSpeed;

    const timerId = window.setInterval(() => {
      const { currentEventIndex: idx } = playStateRef.current;
      const totalEvents = eventsRef.current.length;

      if (idx >= totalEvents - 1) {
        // 到达末尾，停止回放
        setIsPlaying(false);
        return;
      }

      setCurrentEventIndex(idx + 1);
    }, intervalMs);

    return () => {
      window.clearInterval(timerId);
    };
  }, [isPlaying, playbackSpeed, events.length]);

  // ===== 选择会话 =====
  const selectSession = useCallback(async (instanceId: string) => {
    setSelectedSessionId(instanceId);
    setIsPlaying(false);
    setCurrentEventIndex(0);

    const sessionEvents = await querySessionEvents(instanceId);
    setEvents(sessionEvents);
  }, []);

  // ===== 播放/暂停 =====
  const togglePlay = useCallback(() => {
    setIsPlaying((prev) => {
      const { currentEventIndex: idx } = playStateRef.current;
      const totalEvents = eventsRef.current.length;

      // 如果已在末尾，重新从头播放
      if (!prev && idx >= totalEvents - 1 && totalEvents > 0) {
        setCurrentEventIndex(0);
      }

      return !prev;
    });
  }, []);

  // ===== 设置回放速度 =====
  const setSpeed = useCallback((speed: number) => {
    setPlaybackSpeed(speed);
  }, []);

  // ===== 定位到指定事件索引 =====
  const seekTo = useCallback(
    (index: number) => {
      const clamped = Math.max(0, Math.min(index, events.length - 1));
      setCurrentEventIndex(clamped);
    },
    [events.length]
  );

  return {
    sessions,
    selectedSessionId,
    events,
    currentEventIndex,
    isPlaying,
    playbackSpeed,
    selectSession,
    togglePlay,
    setSpeed,
    seekTo,
  };
}
