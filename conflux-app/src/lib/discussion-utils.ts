// ===== Discussion Utils =====
// Converts backend DiscussionMessage (Rust struct) to frontend DiscussionMessage
// (agentStore format) for rendering in the chatroom.

import type { AgentInstanceInfo, DiscussionMessage as BackendDiscussionMessage, CodeBlock } from "@/types";
import type { DiscussionMessage as FrontendDiscussionMessage } from "@/stores/agentStore";
import { adapterIdentityColor, DEFAULT_ADAPTER_IDENTITY_COLOR } from "@/lib/agent-visuals";

// ===== Adapter avatar colors =====

// ===== Code block extraction =====

/**
 * Parse code blocks from message content using regex.
 * Matches triple-backtick fences with optional language tag.
 *
 * Examples:
 *   ```python\nprint("hi")\n```   → lang="python", content="print(\"hi\")"
 *   ```\nsome code\n```          → lang="", content="some code"
 *   `inline` (single backtick) → NOT matched
 */
export function parseCodeBlocks(text: string): CodeBlock[] | null {
  const blocks: CodeBlock[] = [];
  const fenceRe = /```(\w*)\n([\s\S]*?)```/g;
  let match: RegExpExecArray | null;
  while ((match = fenceRe.exec(text)) !== null) {
    blocks.push({
      lang: match[1] ?? "",
      content: match[2],
      startOffset: match.index,
      endOffset: match.index + match[0].length,
    });
  }
  return blocks.length > 0 ? blocks : null;
}

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
      ? adapterIdentityColor(info.adapter_id)
      : DEFAULT_ADAPTER_IDENTITY_COLOR;
  } else {
    // System message
    authorInstanceId = "user"; // System messages render as system, not agent
    authorName = "System";
    initials = "SY";
    avatarBg = "#4A4A4A";
  }

  // Use backend-extracted code_blocks if available; otherwise parse from content.
  // Frontend parsing is the fallback until backend populates code_blocks.
  const codeBlocks: CodeBlock[] | null =
    backend.code_blocks?.length ? backend.code_blocks : parseCodeBlocks(backend.content);

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
    codeBlocks,
  };
}
