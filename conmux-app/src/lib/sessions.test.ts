// ===== sessions RECENT store 单测（M⑤h §2，移植 research/harness-parse.cjs pushRecent 段）=====
//
// 测的是从 sessions.ts 导出的纯核心（不触模块单例 / localStorage，避免单例态污染）：
//   applyRecentPush  — 去重(command+cwd 键)/cap/最近优先/cwd 不同不去重（pushRecent 之下的纯逻辑）
//   isRecentEntry    — 运行时类型守卫
//   parseRecentJson  — loadRecent 之下的纯解析核心（null/非数组/损坏 JSON 容错）
//
// pushRecent / loadRecent 本身只在纯核心上加 persist + notify，行为与纯核心一致（防回归）。

import { describe, expect, it } from "vitest";
import {
  applyRecentPush,
  isBareClaudeLaunch,
  isRecentEntry,
  parseRecentJson,
  type RecentEntry,
} from "./sessions";

// ===== B2（2026-07-02 审计 S1）：裸 claude 启动判定（--session-id 注入门）=====
describe("isBareClaudeLaunch", () => {
  it("裸 claude（含 shim 扩展名 / 路径 / 大小写）→ true", () => {
    expect(isBareClaudeLaunch("claude")).toBe(true);
    expect(isBareClaudeLaunch("claude", [])).toBe(true);
    expect(isBareClaudeLaunch("Claude.CMD")).toBe(true);
    expect(isBareClaudeLaunch("C:\\Users\\me\\bin\\claude.exe")).toBe(true);
    expect(isBareClaudeLaunch("/usr/local/bin/claude.ps1")).toBe(true);
  });

  it("用户给了任何显式 args → false（不碰用户命令，veto 纪律）", () => {
    expect(isBareClaudeLaunch("claude", ["-c"])).toBe(false);
    expect(isBareClaudeLaunch("claude", ["--session-id", "abc"])).toBe(false);
  });

  it("非 claude 程序 / 无 program → false", () => {
    expect(isBareClaudeLaunch(undefined)).toBe(false);
    expect(isBareClaudeLaunch("powershell")).toBe(false);
    expect(isBareClaudeLaunch("claudex")).toBe(false);
    expect(isBareClaudeLaunch("not-claude")).toBe(false);
    expect(isBareClaudeLaunch("wsl")).toBe(false);
  });
});

const entry = (over: Partial<RecentEntry> = {}): RecentEntry => ({
  name: "x",
  command: "claude",
  closedAt: 0,
  ...over,
});

describe("applyRecentPush", () => {
  it("dedupes by command+cwd and floats the newest to front", () => {
    let r = applyRecentPush([], entry({ name: "a", command: "claude", closedAt: 1 }), 8);
    r = applyRecentPush(r, entry({ name: "b", command: "wsl", closedAt: 2 }), 8);
    r = applyRecentPush(r, entry({ name: "a2", command: "claude", closedAt: 3 }), 8);
    expect(r.map((e) => e.command)).toEqual(["claude", "wsl"]);
    expect(r[0].closedAt).toBe(3);
  });

  it("caps the list and keeps the most recent entries", () => {
    let r: RecentEntry[] = [];
    for (let i = 0; i < 12; i++) {
      r = applyRecentPush(r, entry({ name: `n${i}`, command: `cmd${i}`, closedAt: i }), 8);
    }
    expect(r.length).toBe(8);
    expect(r[0].command).toBe("cmd11");
    // 最旧的 cmd0..cmd3 被挤出（capped 后只留最近 8 个）。
    expect(r.some((e) => e.command === "cmd0")).toBe(false);
  });

  it("does NOT dedupe when command matches but cwd differs", () => {
    let r = applyRecentPush([], entry({ command: "wsl", cwd: "/a", closedAt: 1 }), 8);
    r = applyRecentPush(r, entry({ command: "wsl", cwd: "/b", closedAt: 2 }), 8);
    expect(r.length).toBe(2);
  });

  it("treats undefined cwd and empty-string cwd as the same key", () => {
    let r = applyRecentPush([], entry({ command: "wsl", closedAt: 1 }), 8);
    r = applyRecentPush(r, entry({ command: "wsl", cwd: "", closedAt: 2 }), 8);
    expect(r.length).toBe(1);
    expect(r[0].closedAt).toBe(2);
  });

  it("does not mutate the input list (returns a new array)", () => {
    const orig: RecentEntry[] = [entry({ command: "wsl", closedAt: 1 })];
    const r = applyRecentPush(orig, entry({ command: "claude", closedAt: 2 }), 8);
    expect(orig.length).toBe(1);
    expect(r.length).toBe(2);
  });
});

describe("isRecentEntry", () => {
  it("accepts a well-formed entry (cwd optional)", () => {
    expect(isRecentEntry({ name: "a", command: "wsl", closedAt: 1 })).toBe(true);
    expect(isRecentEntry({ name: "a", command: "wsl", closedAt: 1, cwd: "/c" })).toBe(true);
  });

  it("rejects non-objects and null", () => {
    expect(isRecentEntry(null)).toBe(false);
    expect(isRecentEntry("nope")).toBe(false);
    expect(isRecentEntry(42)).toBe(false);
  });

  it("rejects entries with wrong field types", () => {
    expect(isRecentEntry({ name: 1, command: "wsl", closedAt: 1 })).toBe(false);
    expect(isRecentEntry({ name: "a", command: "wsl", closedAt: "1" })).toBe(false);
    expect(isRecentEntry({ name: "a", command: "wsl", closedAt: 1, cwd: 5 })).toBe(false);
    expect(isRecentEntry({ command: "wsl", closedAt: 1 })).toBe(false);
  });
});

describe("parseRecentJson (loadRecent corruption tolerance)", () => {
  it("returns [] for null (no stored value)", () => {
    expect(parseRecentJson(null, 8)).toEqual([]);
  });

  it("returns [] for malformed JSON", () => {
    expect(parseRecentJson("{not json", 8)).toEqual([]);
  });

  it("returns [] when the parsed value is not an array", () => {
    expect(parseRecentJson('{"name":"a"}', 8)).toEqual([]);
  });

  it("filters out corrupt entries and keeps valid ones", () => {
    const raw = JSON.stringify([
      { name: "ok", command: "wsl", closedAt: 1 },
      { name: 5, command: "bad", closedAt: 2 },
      "garbage",
      { name: "ok2", command: "claude", closedAt: 3 },
    ]);
    const r = parseRecentJson(raw, 8);
    expect(r.map((e) => e.name)).toEqual(["ok", "ok2"]);
  });

  it("caps the parsed list", () => {
    const arr = Array.from({ length: 12 }, (_, i) => ({
      name: `n${i}`,
      command: `cmd${i}`,
      closedAt: i,
    }));
    expect(parseRecentJson(JSON.stringify(arr), 8).length).toBe(8);
  });
});
