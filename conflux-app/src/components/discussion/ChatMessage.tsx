// ===== ChatMessage 组件 =====
// 讨论面板中的单条消息：avatar + 发送者名称/时间 + 消息正文
// 支持三种发送者类型：User（冰蓝色边框）、Agent（绿色边框+adapter标签）、System（居中灰色斜体）

import type { DiscussionMessageData } from "@/types";

/** ChatMessage 组件 Props */
interface ChatMessageProps {
  /** 消息数据 */
  message: DiscussionMessageData;
  /** Agent 适配器名称（仅 sender.type === "Agent" 时使用） */
  agentName?: string;
}

/**
 * 格式化时间戳为 HH:mm 格式
 */
function formatTime(timestamp: number): string {
  const date = new Date(timestamp);
  const hours = date.getHours().toString().padStart(2, "0");
  const minutes = date.getMinutes().toString().padStart(2, "0");
  return `${hours}:${minutes}`;
}

/**
 * 获取发送者显示名称
 */
function getSenderName(
  sender: DiscussionMessageData["sender"],
  agentName?: string
): string {
  switch (sender.type) {
    case "User":
      return "You";
    case "Agent":
      return agentName ?? `Agent ${sender.value.slice(0, 8)}`;
    case "System":
      return "System";
  }
}

/**
 * 获取 avatar 首字母
 */
function getAvatarInitial(
  sender: DiscussionMessageData["sender"],
  agentName?: string
): string {
  switch (sender.type) {
    case "User":
      return "U";
    case "Agent":
      return agentName ? agentName.charAt(0).toUpperCase() : "A";
    case "System":
      return "S";
  }
}

/**
 * 获取 avatar 边框样式
 */
function getAvatarBorderClass(sender: DiscussionMessageData["sender"]): string {
  switch (sender.type) {
    case "User":
      return "border-[#A8D8EA]"; // 冰蓝色
    case "Agent":
      return "border-[#6BCB77]"; // 绿色
    case "System":
      return "border-[#D4CFC9]"; // 灰色
  }
}

/**
 * 获取 avatar 背景色
 */
function getAvatarBgClass(sender: DiscussionMessageData["sender"]): string {
  switch (sender.type) {
    case "User":
      return "bg-[#E8F4F8]";
    case "Agent":
      return "bg-[#E8F5E9]";
    case "System":
      return "bg-[#F0EDEA]";
  }
}

/** ChatMessage 组件 */
export function ChatMessage({ message, agentName }: ChatMessageProps) {
  const { sender, content, created_at } = message;

  // ===== System 消息：居中灰色斜体，无 avatar =====
  if (sender.type === "System") {
    return (
      <div className="py-3 px-4">
        <p className="text-center text-[#8A8A8A] italic text-sm font-body leading-relaxed">
          {content}
        </p>
      </div>
    );
  }

  // ===== User / Agent 消息：avatar + 内容区 =====
  return (
    <div className="flex gap-3 py-4 px-4">
      {/* Avatar 32px 圆形 */}
      <div
        className={`flex-shrink-0 w-8 h-8 rounded-full border-2 flex items-center justify-center text-xs font-medium ${getAvatarBorderClass(sender)} ${getAvatarBgClass(sender)}`}
      >
        <span className="text-[#5A5A5A]">
          {getAvatarInitial(sender, agentName)}
        </span>
      </div>

      {/* 内容区 */}
      <div className="flex-1 min-w-0">
        {/* 发送者名称 + 时间戳 */}
        <div className="flex items-center gap-2 mb-1">
          <span className="text-sm font-medium text-[#2C2C2C]">
            {getSenderName(sender, agentName)}
          </span>

          {/* Agent 特有的 adapter 名标签 */}
          {sender.type === "Agent" && agentName && (
            <span className="inline-flex items-center px-1.5 py-0.5 rounded text-[10px] font-medium bg-[#E8F5E9] text-[#2E7D32] border border-[#C8E6C9]">
              {agentName}
            </span>
          )}

          <span className="text-xs text-[#8A8A8A] ml-auto flex-shrink-0">
            {formatTime(created_at)}
          </span>
        </div>

        {/* 消息正文 */}
        <p className="font-body text-sm leading-[1.6] text-[#5A5A5A] whitespace-pre-wrap break-words">
          {content}
        </p>
      </div>
    </div>
  );
}
