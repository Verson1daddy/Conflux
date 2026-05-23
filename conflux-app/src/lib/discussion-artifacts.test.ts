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
    ]);

    expect(artifacts).toEqual([
      {
        id: "m-1-0",
        msgId: "m-1",
        authorName: "Claude",
        round: 2,
        blockIdx: 0,
        lang: "ts",
        content: "const a = 1;",
        status: "draft",
      },
      {
        id: "m-1-1",
        msgId: "m-1",
        authorName: "Claude",
        round: 2,
        blockIdx: 1,
        lang: "rs",
        content: "fn main() {}",
        status: "draft",
      },
    ]);
  });

  it("upsertArtifactsForMessage replaces artifacts for the same message id", () => {
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
      },
    ];

    const next = upsertArtifactsForMessage(existing, {
      id: "m-1",
      authorName: "Claude",
      round: 2,
      codeBlocks: [{ lang: "ts", content: "const nextValue = 2;" }],
    });

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
      },
    ]);
  });

  it("replaceArtifactsForMessage carries pin state from optimistic to confirmed message", () => {
    const existing: ArtifactRecord[] = [
      {
        id: "optimistic-0",
        msgId: "optimistic",
        authorName: "You",
        round: 3,
        blockIdx: 0,
        lang: "ts",
        content: "console.log('draft')",
        status: "pinned",
      },
    ];

    const next = replaceArtifactsForMessage(existing, "optimistic", {
      id: "confirmed",
      authorName: "You",
      round: 3,
      codeBlocks: [{ lang: "ts", content: "console.log('draft')" }],
    });

    expect(next).toEqual([
      {
        id: "confirmed-0",
        msgId: "confirmed",
        authorName: "You",
        round: 3,
        blockIdx: 0,
        lang: "ts",
        content: "console.log('draft')",
        status: "pinned",
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
      },
    ];

    expect(toggleArtifactPin(existing, "a-0")).toEqual([
      {
        id: "a-0",
        msgId: "a",
        authorName: "Claude",
        round: 1,
        blockIdx: 0,
        lang: "ts",
        content: "const a = 1;",
        status: "pinned",
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
      },
    ]);
  });
});
