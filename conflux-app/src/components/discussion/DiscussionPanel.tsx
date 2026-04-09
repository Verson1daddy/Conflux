// ===== DiscussionPanel 组件 =====
// 讨论面板主容器：亮色/杂志风，宽 480px
// 层级：Header → MessageList → InputBar
// 支持创建新讨论、选择历史讨论、发送消息、结束讨论

import { useState, useRef, useEffect, useCallback } from "react";
import type { InstanceId } from "@/types";
import { useDiscussion } from "@/hooks/useDiscussion";
import { ChatMessage } from "@/components/discussion/ChatMessage";
import { MemberSelector } from "@/components/discussion/MemberSelector";

/** DiscussionPanel 组件 */
export function DiscussionPanel() {
  const {
    discussions,
    activeDiscussion,
    messages,
    isCreating,
    createDiscussion,
    sendMessage,
    endDiscussion,
    selectDiscussion,
  } = useDiscussion();

  const [inputValue, setInputValue] = useState("");
  const [showCreateForm, setShowCreateForm] = useState(false);
  const [newTopic, setNewTopic] = useState("");
  const [selectedParticipants, setSelectedParticipants] = useState<
    InstanceId[]
  >([]);
  const [showSettings, setShowSettings] = useState(false);

  const messageListRef = useRef<HTMLDivElement>(null);

  // 新消息到达时自动滚动到底部
  useEffect(() => {
    const el = messageListRef.current;
    if (el) {
      el.scrollTop = el.scrollHeight;
    }
  }, [messages.length]);

  // ===== 发送消息 =====
  const handleSend = useCallback(async () => {
    const trimmed = inputValue.trim();
    if (!trimmed || !activeDiscussion) {
      return;
    }
    setInputValue("");
    await sendMessage(trimmed);
  }, [inputValue, activeDiscussion, sendMessage]);

  // ===== 键盘事件：Enter 发送，Shift+Enter 换行 =====
  const handleKeyDown = useCallback(
    (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
      if (e.key === "Enter" && !e.shiftKey) {
        e.preventDefault();
        handleSend();
      }
    },
    [handleSend]
  );

  // ===== 创建讨论 =====
  const handleCreate = useCallback(async () => {
    const trimmedTopic = newTopic.trim();
    if (!trimmedTopic || selectedParticipants.length === 0) {
      return;
    }
    await createDiscussion(trimmedTopic, selectedParticipants);
    setNewTopic("");
    setSelectedParticipants([]);
    setShowCreateForm(false);
  }, [newTopic, selectedParticipants, createDiscussion]);

  // ===== 讨论列表中参与者的 avatar stack =====
  const participantCount = activeDiscussion
    ? activeDiscussion.participant_ids.length
    : 0;

  return (
    <div className="flex flex-col w-[480px] h-full bg-surface-light font-body">
      {/* ===== Header ===== */}
      <div className="flex items-center justify-between px-5 py-4 border-b border-[#D4CFC9]">
        <div className="flex items-center gap-3">
          <h2 className="font-display text-xl font-bold text-[#1A1A1A] tracking-tight">
            Discussion
          </h2>

          {/* Avatar Stack */}
          {activeDiscussion && participantCount > 0 && (
            <div className="flex -space-x-2">
              {activeDiscussion.participant_ids
                .slice(0, 3)
                .map((id, index) => (
                  <div
                    key={id}
                    className="w-6 h-6 rounded-full bg-[#E8F5E9] border-2 border-white flex items-center justify-center text-[10px] font-medium text-[#5A5A5A]"
                    style={{ zIndex: 3 - index }}
                  >
                    {id.charAt(0).toUpperCase()}
                  </div>
                ))}
              {participantCount > 3 && (
                <div className="w-6 h-6 rounded-full bg-[#F0EDEA] border-2 border-white flex items-center justify-center text-[10px] font-medium text-[#8A8A8A]">
                  +{participantCount - 3}
                </div>
              )}
            </div>
          )}
        </div>

        <div className="flex items-center gap-2">
          {/* 新建讨论按钮 */}
          <button
            type="button"
            onClick={() => setShowCreateForm((prev) => !prev)}
            className="p-1.5 rounded-md hover:bg-surface-light-secondary transition-colors"
            aria-label="New discussion"
          >
            <svg
              width="18"
              height="18"
              viewBox="0 0 18 18"
              fill="none"
              stroke="#5A5A5A"
              strokeWidth="1.5"
              strokeLinecap="round"
            >
              <path d="M9 3v12M3 9h12" />
            </svg>
          </button>

          {/* Settings 按钮 */}
          <button
            type="button"
            onClick={() => setShowSettings((prev) => !prev)}
            className="p-1.5 rounded-md hover:bg-surface-light-secondary transition-colors"
            aria-label="Discussion settings"
          >
            <svg
              width="18"
              height="18"
              viewBox="0 0 18 18"
              fill="none"
              stroke="#5A5A5A"
              strokeWidth="1.5"
              strokeLinecap="round"
            >
              <circle cx="9" cy="9" r="2.5" />
              <path d="M9 1.5v2M9 14.5v2M1.5 9h2M14.5 9h2M3.4 3.4l1.4 1.4M13.2 13.2l1.4 1.4M3.4 14.6l1.4-1.4M13.2 4.8l1.4-1.4" />
            </svg>
          </button>
        </div>
      </div>

      {/* ===== 创建讨论表单 ===== */}
      {showCreateForm && (
        <div className="px-5 py-4 border-b border-[#D4CFC9] bg-surface-light-secondary">
          <h3 className="text-sm font-medium text-[#2C2C2C] mb-3">
            New Discussion
          </h3>

          {/* Topic 输入 */}
          <input
            type="text"
            placeholder="Discussion topic..."
            value={newTopic}
            onChange={(e) => setNewTopic(e.target.value)}
            className="w-full px-3 py-2 mb-3 text-sm rounded-lg border border-[#D4CFC9] bg-white text-[#1A1A1A] placeholder-[#8A8A8A] outline-none focus:border-[#A8D8EA] transition-colors"
          />

          {/* 参与者选择 */}
          <p className="text-xs text-[#8A8A8A] mb-2">Select participants:</p>
          <MemberSelector
            selected={selectedParticipants}
            onSelectionChange={setSelectedParticipants}
          />

          {/* 操作按钮 */}
          <div className="flex justify-end gap-2 mt-3">
            <button
              type="button"
              onClick={() => setShowCreateForm(false)}
              className="px-3 py-1.5 text-sm text-[#5A5A5A] rounded-md hover:bg-[#F0EDEA] transition-colors"
            >
              Cancel
            </button>
            <button
              type="button"
              onClick={handleCreate}
              disabled={
                isCreating ||
                !newTopic.trim() ||
                selectedParticipants.length === 0
              }
              className="px-3 py-1.5 text-sm font-medium text-white bg-[#1A1A1A] rounded-md hover:bg-[#333] disabled:opacity-40 disabled:cursor-not-allowed transition-colors"
            >
              {isCreating ? "Creating..." : "Create"}
            </button>
          </div>
        </div>
      )}

      {/* ===== Settings 下拉面板 ===== */}
      {showSettings && activeDiscussion && (
        <div className="px-5 py-3 border-b border-[#D4CFC9] bg-surface-light-secondary">
          <div className="flex items-center justify-between">
            <div>
              <p className="text-sm font-medium text-[#2C2C2C]">
                {activeDiscussion.topic}
              </p>
              <p className="text-xs text-[#8A8A8A] mt-0.5">
                Round {activeDiscussion.current_round} /{" "}
                {activeDiscussion.max_rounds} &middot;{" "}
                {activeDiscussion.status === "active" ? "Active" : "Completed"}
              </p>
            </div>
            {activeDiscussion.status === "active" && (
              <button
                type="button"
                onClick={endDiscussion}
                className="px-3 py-1.5 text-sm font-medium text-[#EF5350] border border-[#EF5350] rounded-md hover:bg-[#FFF5F5] transition-colors"
              >
                End Discussion
              </button>
            )}
          </div>
        </div>
      )}

      {/* ===== 讨论列表（无活跃讨论时显示） ===== */}
      {!activeDiscussion && !showCreateForm && (
        <div className="flex-1 overflow-y-auto px-5 py-4">
          {discussions.length === 0 ? (
            <div className="flex flex-col items-center justify-center h-full text-[#8A8A8A]">
              <p className="text-sm">No discussions yet</p>
              <p className="text-xs mt-1">Create one to get started</p>
            </div>
          ) : (
            <div className="flex flex-col gap-2">
              {discussions.map((disc) => (
                <button
                  key={disc.id}
                  type="button"
                  onClick={() => selectDiscussion(disc)}
                  className="flex flex-col gap-1 px-4 py-3 rounded-lg border border-[#D4CFC9] bg-white hover:bg-surface-light-secondary text-left transition-colors"
                >
                  <span className="text-sm font-medium text-[#2C2C2C] truncate">
                    {disc.topic}
                  </span>
                  <div className="flex items-center gap-2 text-xs text-[#8A8A8A]">
                    <span>{disc.participant_ids.length} participants</span>
                    <span>&middot;</span>
                    <span>
                      {disc.status === "active" ? "Active" : "Completed"}
                    </span>
                    <span>&middot;</span>
                    <span>
                      {new Date(disc.created_at).toLocaleDateString()}
                    </span>
                  </div>
                </button>
              ))}
            </div>
          )}
        </div>
      )}

      {/* ===== MessageList ===== */}
      {activeDiscussion && (
        <div
          ref={messageListRef}
          className="flex-1 overflow-y-auto"
        >
          {messages.length === 0 ? (
            <div className="flex items-center justify-center h-full text-[#8A8A8A]">
              <p className="text-sm">No messages yet. Start the conversation.</p>
            </div>
          ) : (
            <div className="flex flex-col">
              {messages.map((msg, index) => (
                <div key={msg.id}>
                  <ChatMessage message={msg} />
                  {/* 分隔线（最后一条消息后不显示） */}
                  {index < messages.length - 1 && (
                    <div className="mx-4 border-b border-[#D4CFC9]" />
                  )}
                </div>
              ))}
            </div>
          )}
        </div>
      )}

      {/* ===== InputBar ===== */}
      {activeDiscussion && activeDiscussion.status === "active" && (
        <div className="flex items-end gap-2 px-4 py-3 border-t border-[#D4CFC9] bg-surface-light-secondary">
          <textarea
            value={inputValue}
            onChange={(e) => setInputValue(e.target.value)}
            onKeyDown={handleKeyDown}
            placeholder="Type a message..."
            rows={1}
            className="flex-1 min-h-[40px] max-h-[120px] px-4 py-2.5 text-sm font-body text-[#1A1A1A] placeholder-[#8A8A8A] bg-white border border-[#D4CFC9] rounded-xl outline-none resize-none focus:border-[#A8D8EA] transition-colors"
          />
          <button
            type="button"
            onClick={handleSend}
            disabled={!inputValue.trim()}
            className="flex-shrink-0 w-10 h-10 flex items-center justify-center rounded-xl bg-[#1A1A1A] text-white hover:bg-[#333] disabled:opacity-30 disabled:cursor-not-allowed transition-colors"
            aria-label="Send message"
          >
            <svg
              width="16"
              height="16"
              viewBox="0 0 16 16"
              fill="none"
            >
              <path
                d="M14 2L7 9M14 2L10 14L7 9M14 2L2 6L7 9"
                stroke="currentColor"
                strokeWidth="1.5"
                strokeLinecap="round"
                strokeLinejoin="round"
              />
            </svg>
          </button>
        </div>
      )}

      {/* 已结束讨论的只读提示 */}
      {activeDiscussion && activeDiscussion.status !== "active" && (
        <div className="px-4 py-3 border-t border-[#D4CFC9] bg-surface-light-secondary">
          <p className="text-center text-sm text-[#8A8A8A] italic">
            This discussion has ended
          </p>
        </div>
      )}
    </div>
  );
}
