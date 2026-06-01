export type ArtifactStatus = "draft" | "pinned";

export interface ArtifactCodeBlock {
  lang: string;
  content: string;
}

export interface ArtifactSourceMessage {
  id: string;
  authorName: string;
  round: number;
  codeBlocks: ArtifactCodeBlock[] | null;
}

export interface ArtifactRecord {
  id: string;
  msgId: string;
  authorName: string;
  round: number;
  blockIdx: number;
  lang: string;
  content: string;
  status: ArtifactStatus;
  createdAt: number;
  updatedAt: number;
}

function artifactId(now: number, sequence: number): string {
  return `artifact-${now}-${sequence}`;
}

function buildArtifacts(
  message: ArtifactSourceMessage,
  previousByBlockIdx: Map<number, ArtifactRecord> = new Map(),
  now = Date.now(),
  sequenceOffset = 0,
): ArtifactRecord[] {
  if (!message.codeBlocks?.length) return [];

  return message.codeBlocks.map((block, blockIdx) => {
    const previous = previousByBlockIdx.get(blockIdx);
    return {
      id: previous?.id ?? artifactId(now, sequenceOffset + blockIdx),
      msgId: message.id,
      authorName: message.authorName,
      round: message.round,
      blockIdx,
      lang: block.lang,
      content: block.content,
      status: previous?.status ?? "draft",
      createdAt: previous?.createdAt ?? now,
      updatedAt: previous && previous.content === block.content ? previous.updatedAt : now,
    };
  });
}

export function collectArtifacts(messages: ArtifactSourceMessage[], now = Date.now()): ArtifactRecord[] {
  let sequenceOffset = 0;
  return messages.flatMap((message) => {
    const artifacts = buildArtifacts(message, undefined, now, sequenceOffset);
    sequenceOffset += artifacts.length;
    return artifacts;
  });
}

export function upsertArtifactsForMessage(
  artifacts: ArtifactRecord[],
  message: ArtifactSourceMessage,
  now = Date.now(),
): ArtifactRecord[] {
  const previousByBlockIdx = new Map(
    artifacts
      .filter((artifact) => artifact.msgId === message.id)
      .map((artifact) => [artifact.blockIdx, artifact]),
  );

  const remaining = artifacts.filter((artifact) => artifact.msgId !== message.id);
  return [...remaining, ...buildArtifacts(message, previousByBlockIdx, now, artifacts.length)];
}

export function replaceArtifactsForMessage(
  artifacts: ArtifactRecord[],
  previousMsgId: string,
  message: ArtifactSourceMessage,
  now = Date.now(),
): ArtifactRecord[] {
  const previousByBlockIdx = new Map(
    artifacts
      .filter((artifact) => artifact.msgId === previousMsgId)
      .map((artifact) => [artifact.blockIdx, artifact]),
  );

  const remaining = artifacts.filter(
    (artifact) => artifact.msgId !== previousMsgId && artifact.msgId !== message.id,
  );

  return [...remaining, ...buildArtifacts(message, previousByBlockIdx, now, artifacts.length)];
}

export function toggleArtifactPin(
  artifacts: ArtifactRecord[],
  artifactId: string,
  now = Date.now(),
): ArtifactRecord[] {
  return artifacts.map((artifact) =>
    artifact.id !== artifactId
      ? artifact
      : {
          ...artifact,
          status: artifact.status === "pinned" ? "draft" : "pinned",
          updatedAt: now,
        },
  );
}
