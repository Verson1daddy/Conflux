// ===== Discussion Store (zustand) =====
// 管理讨论面板的全局状态：活跃讨论、消息列表、讨论列表、创建状态

import { create } from "zustand";
import type {
  DiscussionSession,
  DiscussionMessageData,
} from "@/types";

/** 讨论面板全局状态 */
interface DiscussionStoreState {
  /** 当前活跃的讨论会话 */
  activeDiscussion: DiscussionSession | null;
  /** 当前活跃讨论的消息列表 */
  messages: DiscussionMessageData[];
  /** 所有讨论会话列表 */
  discussions: DiscussionSession[];
  /** 是否正在创建新讨论 */
  isCreating: boolean;

  // ===== actions =====

  /** 设置活跃讨论会话 */
  setActiveDiscussion: (session: DiscussionSession | null) => void;
  /** 替换整个消息列表（加载历史消息时使用） */
  setMessages: (messages: DiscussionMessageData[]) => void;
  /** 追加单条消息（实时事件推送时使用） */
  addMessage: (message: DiscussionMessageData) => void;
  /** 替换整个讨论列表 */
  setDiscussions: (discussions: DiscussionSession[]) => void;
  /** 设置创建中状态 */
  setIsCreating: (creating: boolean) => void;
}

/** 讨论面板 zustand store */
export const useDiscussionStore = create<DiscussionStoreState>((set) => ({
  activeDiscussion: null,
  messages: [],
  discussions: [],
  isCreating: false,

  setActiveDiscussion: (session) => set({ activeDiscussion: session }),

  setMessages: (messages) => set({ messages }),

  addMessage: (message) =>
    set((state) => {
      // 防止重复消息（基于 message.id 去重）
      const exists = state.messages.some((m) => m.id === message.id);
      if (exists) {
        return state;
      }
      return { messages: [...state.messages, message] };
    }),

  setDiscussions: (discussions) => set({ discussions }),

  setIsCreating: (creating) => set({ isCreating: creating }),
}));
