import { describe, expect, it } from "vitest";

import {
  DISCUSSION_REVIEW_STORAGE_KEY,
  buildDiscussionReviewSnapshot,
  loadDiscussionReviewSnapshot,
  saveDiscussionReviewSnapshot,
} from "./discussion-review";
import type { DiscussionArtifact, DiscussionMessage } from "@/stores/agentStore";
import type { DiscussionSummary } from "@/types";

const summary: DiscussionSummary = {
  discussion_id: "discussion-1",
  topic: "Ship V1",
  total_rounds: 3,
  summary_text: "The team agreed on the remaining V1 closure path.",
  ended_at: 1_785_000_000_000,
};

const artifacts: DiscussionArtifact[] = [
  {
    id: "artifact-1",
    msgId: "m-1",
    authorName: "Claude",
    round: 2,
    blockIdx: 0,
    lang: "ts",
    content: "export const pinned = true;",
    status: "pinned",
    createdAt: 1_785_000_000_100,
    updatedAt: 1_785_000_000_100,
  },
  {
    id: "artifact-2",
    msgId: "m-2",
    authorName: "Codex",
    round: 3,
    blockIdx: 0,
    lang: "rs",
    content: "fn draft() {}",
    status: "draft",
    createdAt: 1_785_000_000_200,
    updatedAt: 1_785_000_000_200,
  },
];

const messages: DiscussionMessage[] = [
  {
    id: "m-1",
    authorInstanceId: "agent-1",
    authorName: "Claude",
    initials: "CC",
    avatarBg: "#B8D4E3",
    round: 2,
    interject: false,
    time: 1_785_000_000_100,
    body: "Pinned proposal",
    codeBlocks: [
      {
        lang: "ts",
        content: "export const pinned = true;",
        startOffset: 0,
        endOffset: 27,
      },
    ],
  },
  {
    id: "m-2",
    authorInstanceId: "user",
    authorName: "You",
    initials: "U",
    avatarBg: "#1A1A1A",
    round: 3,
    interject: true,
    time: 1_785_000_000_200,
    body: "Keep the draft too",
    codeBlocks: null,
  },
];

describe("discussion review snapshot", () => {
  it("keeps ended discussion summary, all artifacts, messages, and deterministic save time", () => {
    const snapshot = buildDiscussionReviewSnapshot({
      summary,
      artifacts,
      messages,
      savedAt: 1_785_000_001_000,
    });

    expect(snapshot).toEqual({
      summary,
      artifacts,
      messages,
      saved_at: 1_785_000_001_000,
      disposition: "pending_review",
      artifact_counts: {
        total: 2,
        pinned: 1,
        draft: 1,
      },
    });
  });

  it("records saved and discarded review dispositions", () => {
    expect(buildDiscussionReviewSnapshot({
      summary,
      artifacts,
      messages,
      savedAt: 1_785_000_001_000,
      disposition: "saved",
    }).disposition).toBe("saved");

    expect(buildDiscussionReviewSnapshot({
      summary,
      artifacts,
      messages,
      savedAt: 1_785_000_001_000,
      disposition: "discarded",
    }).disposition).toBe("discarded");
  });

  it("writes the canonical review payload to storage", () => {
    const writes = new Map<string, string>();
    const storage = {
      setItem: (key: string, value: string) => writes.set(key, value),
    };
    const snapshot = buildDiscussionReviewSnapshot({
      summary,
      artifacts,
      messages,
      savedAt: 1_785_000_001_000,
    });

    saveDiscussionReviewSnapshot(storage, snapshot);

    expect(writes.get(DISCUSSION_REVIEW_STORAGE_KEY)).toBe(JSON.stringify(snapshot));
  });

  it("loads a valid saved review snapshot from storage", () => {
    const snapshot = buildDiscussionReviewSnapshot({
      summary,
      artifacts,
      messages,
      savedAt: 1_785_000_001_000,
    });
    const storage = {
      getItem: (key: string) =>
        key === DISCUSSION_REVIEW_STORAGE_KEY ? JSON.stringify(snapshot) : null,
    };

    expect(loadDiscussionReviewSnapshot(storage)).toEqual(snapshot);
  });

  it("ignores missing, corrupt, or incomplete saved review payloads", () => {
    expect(loadDiscussionReviewSnapshot({ getItem: () => null })).toBeNull();
    expect(loadDiscussionReviewSnapshot({ getItem: () => "{not-json" })).toBeNull();
    expect(
      loadDiscussionReviewSnapshot({
        getItem: () =>
          JSON.stringify({
            summary,
            artifacts: "not-an-array",
            messages,
            saved_at: 1_785_000_001_000,
            artifact_counts: { total: 2, pinned: 1, draft: 1 },
          }),
      }),
    ).toBeNull();
  });
});
