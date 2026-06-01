import { act, create, type ReactTestRenderer } from "react-test-renderer";
import { describe, expect, it, vi } from "vitest";

import { DiscussionReviewModal } from "./DiscussionReviewModal";
import type { DiscussionReviewSnapshot } from "@/lib/discussion-review";

function collectText(value: unknown): string {
  if (typeof value === "string" || typeof value === "number") {
    return String(value);
  }
  if (!value || typeof value !== "object") {
    return "";
  }
  const maybeChildren = (value as { children?: unknown[] }).children;
  if (!Array.isArray(maybeChildren)) {
    return "";
  }
  return maybeChildren.map(collectText).join(" ");
}

const snapshot: DiscussionReviewSnapshot = {
  summary: {
    discussion_id: "discussion-1",
    topic: "V1 closure",
    total_rounds: 4,
    summary_text: "Keep the remaining release work staged and audited.",
    ended_at: 1_785_000_000_000,
  },
  artifacts: [
    {
      id: "m-1-0",
      msgId: "m-1",
      authorName: "Claude",
      round: 2,
      blockIdx: 0,
      lang: "ts",
      content: "export const plan = true;",
      status: "pinned",
      createdAt: 1_785_000_000_100,
      updatedAt: 1_785_000_000_100,
    },
    {
      id: "m-2-0",
      msgId: "m-2",
      authorName: "Codex",
      round: 3,
      blockIdx: 0,
      lang: "rs",
      content: "fn audit() {}",
      status: "draft",
      createdAt: 1_785_000_000_200,
      updatedAt: 1_785_000_000_200,
    },
  ],
  messages: [],
  saved_at: 1_785_000_001_000,
  disposition: "saved",
  artifact_counts: {
    total: 2,
    pinned: 1,
    draft: 1,
  },
};

describe("DiscussionReviewModal", () => {
  it("renders saved discussion summary and artifact counts", async () => {
    let renderer!: ReactTestRenderer;

    await act(async () => {
      renderer = create(
        <DiscussionReviewModal
          visible={true}
          snapshot={snapshot}
          onClose={vi.fn()}
        />,
      );
    });

    const text = collectText(renderer.toJSON());

    expect(text).toContain("Last Discussion Review");
    expect(text).toContain("Saved");
    expect(text).toContain("V1 closure");
    expect(text).toContain("Keep the remaining release work staged and audited.");
    expect(text).toContain("2 artifacts");
    expect(text).toContain("1 pinned");
    expect(text).toContain("1 draft");
  });

  it("renders an empty state when no saved review exists", async () => {
    let renderer!: ReactTestRenderer;

    await act(async () => {
      renderer = create(
        <DiscussionReviewModal
          visible={true}
          snapshot={null}
          onClose={vi.fn()}
        />,
      );
    });

    expect(collectText(renderer.toJSON())).toContain("No saved discussion review yet.");
  });
});
