import { describe, expect, it } from "vitest";

import {
  hasTerminalOutputEvents,
  summarizeSessionEvent,
} from "./session-events";

const baseEvent = {
  id: 1,
  instance_id: "agent-1",
  timestamp: 1_717_200_000_000,
};

describe("session event summaries", () => {
  it("summarizes serde-tagged status changes without exposing raw JSON", () => {
    expect(
      summarizeSessionEvent({
        ...baseEvent,
        event_type: "AgentStatusChanged",
        data: JSON.stringify({
          type: "AgentStatusChanged",
          payload: {
            instance_id: "agent-1",
            old_status: "idle",
            new_status: "running",
            timestamp: baseEvent.timestamp,
          },
        }),
      })
    ).toBe("idle -> running");
  });

  it("summarizes nested discussion messages from the payload content", () => {
    expect(
      summarizeSessionEvent({
        ...baseEvent,
        event_type: "DiscussionMessage",
        data: JSON.stringify({
          type: "DiscussionMessage",
          payload: {
            discussion_id: "discussion-1",
            message: {
              id: "msg-1",
              discussion_id: "discussion-1",
              sender: { type: "User" },
              content: "Please compare the current V1 risk list.",
              round: 1,
              created_at: baseEvent.timestamp,
            },
            timestamp: baseEvent.timestamp,
          },
        }),
      })
    ).toBe("Please compare the current V1 risk list.");
  });

  it("summarizes PTY output chunks instead of displaying encoded terminal data", () => {
    expect(
      summarizeSessionEvent({
        ...baseEvent,
        event_type: "PtyOutput",
        data: JSON.stringify({
          type: "PtyOutput",
          payload: {
            instance_id: "agent-1",
            data: "SGVsbG8NCg==",
            timestamp: baseEvent.timestamp,
          },
        }),
      })
    ).toBe("Terminal output chunk (7 bytes)");
  });

  it("detects whether a session has real terminal output events", () => {
    expect(
      hasTerminalOutputEvents([
        {
          ...baseEvent,
          event_type: "TaskCompleted",
          data: JSON.stringify({
            type: "TaskCompleted",
            payload: { summary: "done", timestamp: baseEvent.timestamp },
          }),
        },
      ])
    ).toBe(false);

    expect(
      hasTerminalOutputEvents([
        {
          ...baseEvent,
          event_type: "PtyOutput",
          data: JSON.stringify({
            type: "PtyOutput",
            payload: { data: "SGVsbG8=", timestamp: baseEvent.timestamp },
          }),
        },
      ])
    ).toBe(true);
  });
});
