// ===== useEventStream Hook =====
// Subscribes to PtyOutput events for a specific agent instance
// Decodes base64 data, splits into lines, maintains a 500-line buffer
// M-03 修复：使用 RAF 节流防止高频事件冻结 UI

import { useState, useEffect, useRef, useCallback } from "react";
import { onPtyOutputForInstance } from "@/lib/event-listener";

/** Maximum number of lines retained in the buffer */
const MAX_LINES = 500;

/**
 * Hook that streams PTY output for a specific agent instance.
 * Uses requestAnimationFrame batching to prevent UI freezes from rapid events.
 *
 * @param instanceId - The agent instance to subscribe to
 * @returns lines (up to 500 most recent) and isStreaming flag
 */
export function useEventStream(instanceId: string) {
  const [lines, setLines] = useState<string[]>([]);
  const [isStreaming, setIsStreaming] = useState(false);
  const linesRef = useRef<string[]>([]);
  const partialRef = useRef("");
  // M-03: RAF 节流——累积数据在 ref 中，每帧刷新一次
  const pendingDataRef = useRef<string[]>([]);
  const rafIdRef = useRef<number | null>(null);

  const flushPendingData = useCallback(() => {
    rafIdRef.current = null;

    const pending = pendingDataRef.current;
    if (pending.length === 0) return;
    pendingDataRef.current = [];

    // 合并所有待处理数据
    const combined = pending.join("");
    if (combined.length === 0) return;

    setIsStreaming(true);

    const fullText = partialRef.current + combined;
    const segments = fullText.split(/\r?\n/);

    const lastSegment = segments[segments.length - 1];
    if (combined.endsWith("\n") || combined.endsWith("\r\n")) {
      partialRef.current = "";
    } else {
      partialRef.current = lastSegment;
      segments.pop();
    }

    if (segments.length === 0) return;

    const newLines = [...linesRef.current, ...segments];
    const trimmed =
      newLines.length > MAX_LINES
        ? newLines.slice(newLines.length - MAX_LINES)
        : newLines;

    linesRef.current = trimmed;
    setLines(trimmed);
  }, []);

  const appendData = useCallback((rawData: string) => {
    let decoded: string;
    try {
      decoded = atob(rawData);
    } catch {
      // base64 解码失败时使用原始字符串并记录警告
      console.warn("[useEventStream] base64 decode failed, using raw data");
      decoded = rawData;
    }

    if (decoded.length === 0) return;

    // M-03: 累积到 ref，下一帧统一刷新
    pendingDataRef.current.push(decoded);
    if (rafIdRef.current === null) {
      rafIdRef.current = requestAnimationFrame(flushPendingData);
    }
  }, [flushPendingData]);

  useEffect(() => {
    linesRef.current = [];
    partialRef.current = "";
    pendingDataRef.current = [];
    if (rafIdRef.current !== null) {
      cancelAnimationFrame(rafIdRef.current);
      rafIdRef.current = null;
    }
    setLines([]);
    setIsStreaming(false);

    if (!instanceId) return;

    const unlistenPromise = onPtyOutputForInstance(instanceId, (payload) => {
      appendData(payload.data);
    });

    return () => {
      unlistenPromise.then((fn) => fn());
      if (rafIdRef.current !== null) {
        cancelAnimationFrame(rafIdRef.current);
        rafIdRef.current = null;
      }
    };
  }, [instanceId, appendData]);

  return { lines, isStreaming };
}
