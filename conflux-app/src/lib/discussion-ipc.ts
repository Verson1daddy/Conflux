// ===== Discussion IPC orchestration layer =====
// Coordinates Tauri IPC calls for the discussion lifecycle:
//   start -> send messages (with PTY injection) -> end
//
// This module sits between agentStore actions and tauri-bridge,
// handling the multi-step orchestration that a single invoke can't cover
// (e.g., send a message to the backend AND inject it into each agent's PTY).

import {
  startDiscussion,
  sendDiscussionMessage,
  endDiscussion,
  injectDiscussionMessage,
} from "@/lib/tauri-bridge";
import { PTY_ENTER } from "@/lib/constants";
import type {
  DiscussionSession,
  DiscussionMessage,
  DiscussionSummary,
} from "@/types";

/**
 * Start a new backend discussion session.
 *
 * @param topic          — The discussion topic / direction text
 * @param participantIds — Instance IDs of all participating agents
 * @param maxRounds      — Maximum number of rounds (0 = unlimited)
 * @returns The created DiscussionSession from the backend
 */
export async function startBackendDiscussion(
  topic: string,
  participantIds: string[],
  maxRounds: number,
): Promise<DiscussionSession> {
  return startDiscussion(topic, participantIds, maxRounds || undefined);
}

/**
 * Send a user message to the discussion AND inject it into each participant's PTY.
 *
 * Uses Promise.allSettled for the injection step so that one agent's failure
 * doesn't block the message from reaching others (Red Team requirement).
 *
 * @param discussionId     — Active discussion ID
 * @param content          — User message text
 * @param targetInstanceIds — Instance IDs to inject the message into via PTY stdin
 * @returns The persisted DiscussionMessage from the backend
 */
interface InjectionResult {
  instanceId: string;
  ok: boolean;
  error?: unknown;
}

export async function sendMessageWithInjection(
  discussionId: string,
  content: string,
  targetInstanceIds: string[],
): Promise<DiscussionMessage> {
  // Step 1: Persist the message in the backend discussion store
  const msg = await sendDiscussionMessage(discussionId, content);

  const injectionResults = await Promise.all(
    targetInstanceIds.map(async (id): Promise<InjectionResult> => {
      try {
        await injectDiscussionMessage(id, content + PTY_ENTER);
        return { instanceId: id, ok: true };
      } catch (error) {
        console.warn(`[discussion-ipc] inject to ${id} failed:`, error);
        return { instanceId: id, ok: false, error };
      }
    }),
  );

  if (injectionResults.length > 0 && injectionResults.every((result) => !result.ok)) {
    throw new Error("Failed to inject the interject message into every participant PTY.");
  }

  return msg;
}

/**
 * End the active discussion session.
 *
 * @param discussionId — The discussion to end
 * @returns The discussion summary from the backend
 */
export async function endBackendDiscussion(
  discussionId: string,
): Promise<DiscussionSummary> {
  return endDiscussion(discussionId);
}
