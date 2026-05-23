import type { DiscussionArtifact, DiscussionMessage } from "@/stores/agentStore";
import type { DiscussionSummary } from "@/types";

export const DISCUSSION_REVIEW_STORAGE_KEY = "conflux.lastDiscussionReview";

export interface DiscussionReviewArtifactCounts {
  total: number;
  pinned: number;
  draft: number;
}

export interface DiscussionReviewSnapshot {
  summary: DiscussionSummary;
  artifacts: DiscussionArtifact[];
  messages: DiscussionMessage[];
  saved_at: number;
  artifact_counts: DiscussionReviewArtifactCounts;
}

export interface BuildDiscussionReviewSnapshotInput {
  summary: DiscussionSummary;
  artifacts: DiscussionArtifact[];
  messages: DiscussionMessage[];
  savedAt?: number;
}

export interface DiscussionReviewStorage {
  setItem: (key: string, value: string) => void;
}

export interface ReadDiscussionReviewStorage {
  getItem: (key: string) => string | null;
}

export function buildDiscussionReviewSnapshot({
  summary,
  artifacts,
  messages,
  savedAt = Date.now(),
}: BuildDiscussionReviewSnapshotInput): DiscussionReviewSnapshot {
  const artifactCounts = artifacts.reduce<DiscussionReviewArtifactCounts>(
    (counts, artifact) => {
      counts.total += 1;
      if (artifact.status === "pinned") counts.pinned += 1;
      else counts.draft += 1;
      return counts;
    },
    { total: 0, pinned: 0, draft: 0 },
  );

  return {
    summary: { ...summary },
    artifacts: artifacts.map((artifact) => ({ ...artifact })),
    messages: messages.map((message) => ({
      ...message,
      codeBlocks: message.codeBlocks?.map((block) => ({ ...block })) ?? null,
    })),
    saved_at: savedAt,
    artifact_counts: artifactCounts,
  };
}

export function saveDiscussionReviewSnapshot(
  storage: DiscussionReviewStorage,
  snapshot: DiscussionReviewSnapshot,
): void {
  storage.setItem(DISCUSSION_REVIEW_STORAGE_KEY, JSON.stringify(snapshot));
}

export function loadDiscussionReviewSnapshot(
  storage: ReadDiscussionReviewStorage,
): DiscussionReviewSnapshot | null {
  const raw = storage.getItem(DISCUSSION_REVIEW_STORAGE_KEY);
  if (!raw) return null;

  try {
    const parsed = JSON.parse(raw) as unknown;
    return isDiscussionReviewSnapshot(parsed) ? parsed : null;
  } catch {
    return null;
  }
}

function isDiscussionReviewSnapshot(value: unknown): value is DiscussionReviewSnapshot {
  if (!value || typeof value !== "object") return false;
  const candidate = value as Partial<DiscussionReviewSnapshot>;
  return (
    isDiscussionSummary(candidate.summary) &&
    Array.isArray(candidate.artifacts) &&
    Array.isArray(candidate.messages) &&
    typeof candidate.saved_at === "number" &&
    isArtifactCounts(candidate.artifact_counts)
  );
}

function isDiscussionSummary(value: unknown): value is DiscussionSummary {
  if (!value || typeof value !== "object") return false;
  const candidate = value as Partial<DiscussionSummary>;
  return (
    typeof candidate.discussion_id === "string" &&
    typeof candidate.topic === "string" &&
    typeof candidate.total_rounds === "number" &&
    typeof candidate.summary_text === "string" &&
    typeof candidate.ended_at === "number"
  );
}

function isArtifactCounts(value: unknown): value is DiscussionReviewArtifactCounts {
  if (!value || typeof value !== "object") return false;
  const candidate = value as Partial<DiscussionReviewArtifactCounts>;
  return (
    typeof candidate.total === "number" &&
    typeof candidate.pinned === "number" &&
    typeof candidate.draft === "number"
  );
}
