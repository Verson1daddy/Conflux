// ===== useDiscussion Hook =====
// 讨论面板业务逻辑：加载讨论列表、切换活跃讨论、监听实时消息、发送消息、创建/结束讨论

import { useEffect, useCallback } from "react";
import type {
  DiscussionSession,
  InstanceId,
  DiscussionMessagePayload,
} from "@/types";
import {
  listDiscussions,
  getDiscussionMessages,
  startDiscussion,
  sendDiscussionMessage,
  endDiscussion as endDiscussionCmd,
} from "@/lib/tauri-bridge";
import { onDiscussionMessage } from "@/lib/event-listener";
import { useDiscussionStore } from "@/stores/discussionStore";

/**
 * 讨论面板核心 hook
 *
 * 功能：
 * - 初始化加载讨论列表
 * - 切换活跃讨论时加载消息历史
 * - 监听 onDiscussionMessage 事件实时追加新消息
 * - 提供 createDiscussion / sendMessage / endDiscussion / selectDiscussion 方法
 */
export function useDiscussion() {
  const {
    discussions,
    activeDiscussion,
    messages,
    isCreating,
    setDiscussions,
    setActiveDiscussion,
    setMessages,
    addMessage,
    setIsCreating,
  } = useDiscussionStore();

  // ===== 初始化：加载讨论列表 =====
  useEffect(() => {
    let cancelled = false;

    async function loadDiscussions() {
      const result = await listDiscussions();
      if (!cancelled) {
        setDiscussions(result);
      }
    }

    loadDiscussions();
    return () => {
      cancelled = true;
    };
  }, [setDiscussions]);

  // ===== 监听讨论消息事件 =====
  useEffect(() => {
    let unlisten: (() => void) | null = null;

    async function subscribe() {
      unlisten = await onDiscussionMessage(
        (payload: DiscussionMessagePayload) => {
          // 只追加属于当前活跃讨论的消息
          const currentDiscussion = useDiscussionStore.getState().activeDiscussion;
          if (
            currentDiscussion &&
            payload.discussion_id === currentDiscussion.id
          ) {
            addMessage(payload.message);
          }
        }
      );
    }

    subscribe();

    return () => {
      if (unlisten) {
        unlisten();
      }
    };
  }, [addMessage]);

  // ===== 选择讨论 =====
  const selectDiscussion = useCallback(
    async (session: DiscussionSession) => {
      setActiveDiscussion(session);
      const msgs = await getDiscussionMessages(session.id);
      setMessages(msgs);
    },
    [setActiveDiscussion, setMessages]
  );

  // ===== 创建讨论 =====
  const createDiscussion = useCallback(
    async (topic: string, participantIds: InstanceId[]) => {
      setIsCreating(true);
      try {
        const session = await startDiscussion(topic, participantIds);
        // 更新讨论列表并自动切换到新讨论
        setDiscussions([
          session,
          ...useDiscussionStore.getState().discussions,
        ]);
        setActiveDiscussion(session);
        setMessages([]);
      } finally {
        setIsCreating(false);
      }
    },
    [setIsCreating, setDiscussions, setActiveDiscussion, setMessages]
  );

  // ===== 发送消息 =====
  const sendMessage = useCallback(
    async (content: string) => {
      const current = useDiscussionStore.getState().activeDiscussion;
      if (!current) {
        return;
      }
      const msg = await sendDiscussionMessage(current.id, content);
      // 立即追加到本地消息列表（事件回调可能有延迟，去重逻辑会处理重复）
      addMessage(msg);
    },
    [addMessage]
  );

  // ===== 结束讨论 =====
  const endDiscussionAction = useCallback(async () => {
    const current = useDiscussionStore.getState().activeDiscussion;
    if (!current) {
      return;
    }
    await endDiscussionCmd(current.id);
    // 更新讨论状态
    const updatedDiscussions = useDiscussionStore
      .getState()
      .discussions.map((d) =>
        d.id === current.id
          ? { ...d, status: "completed" as const, ended_at: Date.now() }
          : d
      );
    setDiscussions(updatedDiscussions);
    setActiveDiscussion({
      ...current,
      status: "completed",
      ended_at: Date.now(),
    });
  }, [setDiscussions, setActiveDiscussion]);

  return {
    discussions,
    activeDiscussion,
    messages,
    isCreating,
    createDiscussion,
    sendMessage,
    endDiscussion: endDiscussionAction,
    selectDiscussion,
  };
}
