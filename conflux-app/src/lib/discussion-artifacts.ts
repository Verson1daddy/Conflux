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
}

function artifactId(msgId: string, blockIdx: number): string {
  return `${msgId}-${blockIdx}`;
}

function buildArtifacts(
  message: ArtifactSourceMessage,
  statusByBlockIdx: Map<number, ArtifactStatus> = new Map(),
): ArtifactRecord[] {
  if (!message.codeBlocks?.length) return [];

  return message.codeBlocks.map((block, blockIdx) => ({
    id: artifactId(message.id, blockIdx),
    msgId: message.id,
    authorName: message.authorName,
    round: message.round,
    blockIdx,
    lang: block.lang,
    content: block.content,
    status: statusByBlockIdx.get(blockIdx) ?? "draft",
  }));
}

export function collectArtifacts(messages: ArtifactSourceMessage[]): ArtifactRecord[] {
  return messages.flatMap((message) => buildArtifacts(message));
}

export function upsertArtifactsForMessage(
  artifacts: ArtifactRecord[],
  message: ArtifactSourceMessage,
): ArtifactRecord[] {
  const previousStatusByBlockIdx = new Map(
    artifacts
      .filter((artifact) => artifact.msgId === message.id)
      .map((artifact) => [artifact.blockIdx, artifact.status]),
  );

  const remaining = artifacts.filter((artifact) => artifact.msgId !== message.id);
  return [...remaining, ...buildArtifacts(message, previousStatusByBlockIdx)];
}

export function replaceArtifactsForMessage(
  artifacts: ArtifactRecord[],
  previousMsgId: string,
  message: ArtifactSourceMessage,
): ArtifactRecord[] {
  const previousStatusByBlockIdx = new Map(
    artifacts
      .filter((artifact) => artifact.msgId === previousMsgId)
      .map((artifact) => [artifact.blockIdx, artifact.status]),
  );

  const remaining = artifacts.filter(
    (artifact) => artifact.msgId !== previousMsgId && artifact.msgId !== message.id,
  );

  return [...remaining, ...buildArtifacts(message, previousStatusByBlockIdx)];
}

export function toggleArtifactPin(
  artifacts: ArtifactRecord[],
  artifactId: string,
): ArtifactRecord[] {
  return artifacts.map((artifact) =>
    artifact.id !== artifactId
      ? artifact
      : {
          ...artifact,
          status: artifact.status === "pinned" ? "draft" : "pinned",
        },
  );
}
