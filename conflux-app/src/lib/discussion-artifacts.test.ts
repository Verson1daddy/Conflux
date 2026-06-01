import { describe, expect, it } from "vitest";

import {
  collectArtifacts,
  replaceArtifactsForMessage,
  toggleArtifactPin,
  upsertArtifactsForMessage,
  type ArtifactRecord,
} from "./discussion-artifacts";

describe("discussion artifacts", () => {
  it("collectArtifacts flattens code blocks into draft artifacts", () => {
    const artifacts = collectArtifacts([
      {
        id: "m-1",
        authorName: "Claude",
        round: 2,
        codeBlocks: [
          { lang: "ts", content: "const a = 1;" },
          { lang: "rs", content: "fn main() {}" },
        ],
      },
    ], 1000);

    expect(artifacts).toEqual([
      {
        id: "artifact-1000-0",
        msgId: "m-1",
        authorName: "Claude",
        round: 2,
        blockIdx: 0,
        lang: "ts",
        content: "const a = 1;",
        status: "draft",
        createdAt: 1000,
        updatedAt: 1000,
      },
      {
        id: "artifact-1000-1",
        msgId: "m-1",
        authorName: "Claude",
        round: 2,
        blockIdx: 1,
        lang: "rs",
        content: "fn main() {}",
        status: "draft",
        createdAt: 1000,
        updatedAt: 1000,
      },
    ]);
  });

  it("collectArtifacts assigns lifecycle ids independent from message block coordinates", () => {
    const artifacts = collectArtifacts([
      {
        id: "m-1",
        authorName: "Claude",
        round: 1,
        codeBlocks: [{ lang: "ts", content: "const a = 1;" }],
      },
    ], 1000);

    expect(artifacts[0]?.id).toBe("artifact-1000-0");
    expect(artifacts[0]?.id).not.toBe("m-1-0");
    expect(artifacts[0]?.msgId).toBe("m-1");
    expect(artifacts[0]?.blockIdx).toBe(0);
  });

  it("upsertArtifactsForMessage preserves artifact identity across message updates", () => {
    const existing: ArtifactRecord[] = [
      {
        id: "m-1-0",
        msgId: "m-1",
        authorName: "Claude",
        round: 1,
        blockIdx: 0,
        lang: "ts",
        content: "const oldValue = 1;",
        status: "pinned",
        createdAt: 900,
        updatedAt: 950,
      },
      {
        id: "m-2-0",
        msgId: "m-2",
        authorName: "Codex",
        round: 1,
        blockIdx: 0,
        lang: "py",
        content: "print('keep me')",
        status: "draft",
        createdAt: 1000,
        updatedAt: 1000,
      },
    ];

    const next = upsertArtifactsForMessage(existing, {
      id: "m-1",
      authorName: "Claude",
      round: 2,
      codeBlocks: [{ lang: "ts", content: "const nextValue = 2;" }],
    }, 1200);

    expect(next).toEqual([
      {
        id: "m-2-0",
        msgId: "m-2",
        authorName: "Codex",
        round: 1,
        blockIdx: 0,
        lang: "py",
        content: "print('keep me')",
        status: "draft",
        createdAt: 1000,
        updatedAt: 1000,
      },
      {
        id: "m-1-0",
        msgId: "m-1",
        authorName: "Claude",
        round: 2,
        blockIdx: 0,
        lang: "ts",
        content: "const nextValue = 2;",
        status: "pinned",
        createdAt: 900,
        updatedAt: 1200,
      },
    ]);
  });

  it("replaceArtifactsForMessage carries lifecycle identity and pin state from optimistic to confirmed message", () => {
    const existing: ArtifactRecord[] = [
      {
        id: "optimistic-artifact",
        msgId: "optimistic",
        authorName: "You",
        round: 3,
        blockIdx: 0,
        lang: "ts",
        content: "console.log('draft')",
        status: "pinned",
        createdAt: 900,
        updatedAt: 950,
      },
    ];

    const next = replaceArtifactsForMessage(existing, "optimistic", {
      id: "confirmed",
      authorName: "You",
      round: 3,
      codeBlocks: [{ lang: "ts", content: "console.log('draft')" }],
    }, 1200);

    expect(next).toEqual([
      {
        id: "optimistic-artifact",
        msgId: "confirmed",
        authorName: "You",
        round: 3,
        blockIdx: 0,
        lang: "ts",
        content: "console.log('draft')",
        status: "pinned",
        createdAt: 900,
        updatedAt: 950,
      },
    ]);
  });

  it("toggleArtifactPin flips only the targeted artifact", () => {
    const existing: ArtifactRecord[] = [
      {
        id: "a-0",
        msgId: "a",
        authorName: "Claude",
        round: 1,
        blockIdx: 0,
        lang: "ts",
        content: "const a = 1;",
        status: "draft",
        createdAt: 1000,
        updatedAt: 1000,
      },
      {
        id: "b-0",
        msgId: "b",
        authorName: "Codex",
        round: 1,
        blockIdx: 0,
        lang: "py",
        content: "print('b')",
        status: "pinned",
        createdAt: 900,
        updatedAt: 950,
      },
    ];

    expect(toggleArtifactPin(existing, "a-0", 1200)).toEqual([
      {
        id: "a-0",
        msgId: "a",
        authorName: "Claude",
        round: 1,
        blockIdx: 0,
        lang: "ts",
        content: "const a = 1;",
        status: "pinned",
        createdAt: 1000,
        updatedAt: 1200,
      },
      {
        id: "b-0",
        msgId: "b",
        authorName: "Codex",
        round: 1,
        blockIdx: 0,
        lang: "py",
        content: "print('b')",
        status: "pinned",
        createdAt: 900,
        updatedAt: 950,
      },
    ]);
  });
});
