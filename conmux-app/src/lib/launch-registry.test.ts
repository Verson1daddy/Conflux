// ===== launch-registry.parseCommand 单测（M⑤h §2，移植 research/harness-parse.cjs 18 例）=====
//
// 纯函数 parseCommand（shell-word split：空格 + 双引号；不支持管道/重定向/变量）。
// 蓝本逻辑已与源逐字对齐（research/conmux-m5b-2026-06-15/harness-parse.cjs）；此处移植为
// 正式 vitest，追边界 + 红队点过的 case（防回归），不追覆盖率数字（D-5）。
//
// rebuildCommand 从 sessions.ts 导出（RECENT 重开往返用）；parse↔rebuild 往返稳定性同测。

import { describe, expect, it } from "vitest";
import { parseCommand } from "./launch-registry";
import { rebuildCommand } from "./sessions";

describe("parseCommand", () => {
  it("splits a simple program + args", () => {
    expect(parseCommand("wsl -d Ubuntu")).toEqual({
      program: "wsl",
      args: ["-d", "Ubuntu"],
    });
  });

  it("handles a single program with no args", () => {
    expect(parseCommand("powershell.exe")).toEqual({
      program: "powershell.exe",
      args: [],
    });
  });

  it("returns empty program/args for empty string", () => {
    expect(parseCommand("")).toEqual({ program: "", args: [] });
  });

  it("returns empty program/args for whitespace-only input", () => {
    expect(parseCommand("   \t  ")).toEqual({ program: "", args: [] });
  });

  it("trims leading/trailing and collapses interior whitespace", () => {
    expect(parseCommand("  wsl   -d  Ubuntu  ")).toEqual({
      program: "wsl",
      args: ["-d", "Ubuntu"],
    });
  });

  it("treats tabs as separators", () => {
    expect(parseCommand("wsl\t-d\tUbuntu")).toEqual({
      program: "wsl",
      args: ["-d", "Ubuntu"],
    });
  });

  it("keeps quoted spaces in the program token", () => {
    expect(parseCommand('"C:\\Program Files\\x.exe" --flag')).toEqual({
      program: "C:\\Program Files\\x.exe",
      args: ["--flag"],
    });
  });

  it("keeps quoted spaces in an arg token", () => {
    expect(parseCommand('claude --resume "my session"')).toEqual({
      program: "claude",
      args: ["--resume", "my session"],
    });
  });

  it("degrades gracefully on an unclosed quote (no throw, captures remainder)", () => {
    expect(parseCommand('wsl -d "Ub')).toEqual({
      program: "wsl",
      args: ["-d", "Ub"],
    });
  });

  it("produces an empty token for explicit empty quotes", () => {
    expect(parseCommand('x ""')).toEqual({ program: "x", args: [""] });
  });

  it("keeps hyphenated general-purpose-style program names intact", () => {
    expect(parseCommand("general-purpose --once")).toEqual({
      program: "general-purpose",
      args: ["--once"],
    });
  });
});

describe("rebuildCommand", () => {
  it("quotes words containing spaces", () => {
    expect(rebuildCommand("C:\\Program Files\\x.exe", ["--flag"])).toBe(
      '"C:\\Program Files\\x.exe" --flag'
    );
  });

  it("leaves space-free tokens unquoted", () => {
    expect(rebuildCommand("wsl", ["-d", "Ubuntu"])).toBe("wsl -d Ubuntu");
  });

  it("treats missing args as empty", () => {
    expect(rebuildCommand("powershell.exe")).toBe("powershell.exe");
  });
});

describe("parse↔rebuild roundtrip (space-free commands stable)", () => {
  for (const c of ["wsl -d Ubuntu", "claude --resume", "powershell.exe"]) {
    it(`roundtrips: ${c}`, () => {
      const p = parseCommand(c);
      const back = parseCommand(rebuildCommand(p.program, p.args));
      expect(back).toEqual(p);
    });
  }
});
