// ===== Discussion Utils =====
// Converts backend DiscussionMessage (Rust struct) to frontend DiscussionMessage
// (agentStore format) for rendering in the chatroom.

import type { AgentInstanceInfo, DiscussionMessage as BackendDiscussionMessage } from "@/types";
import type { DiscussionMessage as FrontendDiscussionMessage } from "@/stores/agentStore";

// ===== Adapter avatar colors =====
// Mirrors the palette in agentStore.ts colorOfAdapter and DiscussionPanel.tsx AVATAR_BY_ADAPTER.
const AVATAR_COLORS: Record<string, string> = {
  "claude-code": "#B8D4E3",
  codex: "#FFB800",
  aider: "#8EA4B8",
  opencode: "#C9B894",
};

const DEFAULT_AVATAR_COLOR = "#8A8A8A";

// ===== Helpers =====

function initialsOf(name: string): string {
  const parts = name.trim().split(/\s+/);
  if (parts.length === 0) return "?";
  if (parts.length === 1) return parts[0].slice(0, 2).toUpperCase();
  return (parts[0][0] + parts[1][0]).toUpperCase();
}

// ===== Converter =====

/**
 * Convert a backend DiscussionMessage (from Tauri IPC) to the frontend
 * DiscussionMessage shape used by agentStore's chatroom.
 *
 * @param backend  — The message object returned by send_discussion_message / get_discussion_messages
 * @param instances — Current instance map from agentStore for resolving agent names
 */
export function toFrontendMessage(
  backend: BackendDiscussionMessage,
  instances: Map<string, AgentInstanceInfo>,
): FrontendDiscussionMessage {
  const sender = backend.sender;

  let authorInstanceId: string | "user";
  let authorName: string;
  let initials: string;
  let avatarBg: string;
  let isInterject = false;

  if (sender.type === "User") {
    authorInstanceId = "user";
    authorName = "You";
    initials = "U";
    avatarBg = "#1A1A1A";
    isInterject = true;
  } else if (sender.type === "Agent") {
    const instanceId = sender.value;
    authorInstanceId = instanceId;
    const info = instances.get(instanceId);
    authorName = info?.adapter_name ?? "Agent";
    initials = initialsOf(authorName);
    avatarBg = info
      ? (AVATAR_COLORS[info.adapter_id] ?? DEFAULT_AVATAR_COLOR)
      : DEFAULT_AVATAR_COLOR;
  } else {
    // System message
    authorInstanceId = "user"; // System messages render as system, not agent
    authorName = "System";
    initials = "SY";
    avatarBg = "#4A4A4A";
  }

  return {
    id: backend.id,
    authorInstanceId,
    authorName,
    initials,
    avatarBg,
    round: backend.round,
    interject: isInterject,
    time: backend.created_at,
    body: backend.content,
  };
}
