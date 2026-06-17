// ===== claude.extractSubagents 单测（M⑤h §2，移植 research/harness-extract.cjs 7 例）=====
//
// 蓝本逻辑已与 claude.ts 逐字对齐（research/conmux-m3ext2-2026-06-15/harness-extract.cjs）；
// 此处移植为正式 vitest。case 1 原读真实 fixture（after-enter.stripped.txt），此处改为内联
// 等价派发帧（与 fixture 同形态：单个 `● Explore(...)` 派发行），避免文件系统耦合、保持确定性。
//
// 诚实铁律（§0）核心 case：派发行命中 / 散文不中 / 工具黑名单(Bash/Read)排除 / mcp__ 排除 /
// done+detail 抽取 / 折叠 running / 诚实空 / general-purpose 连字符。只测不改解析逻辑。

import { describe, expect, it } from "vitest";
import { extractSubagents, sniffClaude } from "./claude";

describe("extractSubagents", () => {
  it("matches a single committed dispatch line (prose excluded)", () => {
    const buf =
      "● Explore(List files in current folder)\n   ⎿  Initializing…\n";
    const r = extractSubagents(buf);
    expect(r).toHaveLength(1);
    expect(r[0].type).toBe("Explore");
    expect(r[0].description).toMatch(/List files in current folder/);
    expect(r[0].status).toBe("running");
  });

  it("extracts done + detail from a Done fold line; prose 'folder (C:..)' not matched", () => {
    const completed =
      "● Explore(List files in current folder)\n" +
      "   ⌊ Done (1 tool use · 18.9k tokens · 16s)\n" +
      "● The Explore subagent finished. Here's what's in your folder (C:\\Users\\zwm):\n";
    const r = extractSubagents(completed);
    expect(r).toHaveLength(1);
    expect(r[0].type).toBe("Explore");
    expect(r[0].status).toBe("done");
    expect(r[0].detail ?? "").toMatch(/1 tool use/);
  });

  it("excludes Bash/Read tool calls (same `● Name(args)` shape, not subagents)", () => {
    const mixed =
      "● Explore(List files in current folder)\n" +
      "   ⎿  Initializing…\n" +
      "● Bash(ls -la /c/Users/zwm)\n" +
      "   ⎿  total 320\n" +
      "● Read(CLAUDE.md)\n" +
      "   ⎿  read 80 lines\n";
    const r = extractSubagents(mixed);
    expect(r).toHaveLength(1);
    expect(r[0].type).toBe("Explore");
  });

  it("excludes MCP tools (mcp__server__tool) while keeping the agent", () => {
    const mcp =
      "● mcp__pencil__batch_get(read nodes)\n" +
      "   ⎿  ok\n" +
      "● Plan(design the migration)\n" +
      "   ⎿  Initializing…\n";
    const r = extractSubagents(mcp);
    expect(r).toHaveLength(1);
    expect(r[0].type).toBe("Plan");
  });

  it("returns [] honestly for shell output with no dispatch lines", () => {
    expect(
      extractSubagents("(base) PS C:\\Users\\zwm> ls\nDirectory: ...\n")
    ).toEqual([]);
  });

  it("includes hyphenated agent types (general-purpose)", () => {
    const gp = "● general-purpose(refactor the auth module)\n   ⎿  Working…\n";
    const r = extractSubagents(gp);
    expect(r).toHaveLength(1);
    expect(r[0].type).toBe("general-purpose");
  });

  it("does not match prose with no tight-paren dispatch line", () => {
    const prose =
      "● I'll launch an Explore subagent to list files.\n" +
      "● The result is in your folder (C:\\Users\\zwm) now.\n";
    expect(extractSubagents(prose)).toEqual([]);
  });

  it("dedupes the same (type, description) and lets done override running", () => {
    const buf =
      "● Explore(scan repo)\n" +
      "   ⎿  Initializing…\n" +
      "● Explore(scan repo)\n" +
      "   ⌊ Done (3 tool uses)\n";
    const r = extractSubagents(buf);
    expect(r).toHaveLength(1);
    expect(r[0].status).toBe("done");
    expect(r[0].detail ?? "").toMatch(/3 tool uses/);
  });

  it("drops dispatch lines with empty description", () => {
    expect(extractSubagents("● Explore()\n")).toEqual([]);
  });
});

describe("sniffClaude (finding-1：alt-screen OSC 标题信号)", () => {
  it("不从 alt-screen scrollback 单独命中（logo 被光标定位打散为 'ClaudeCode' 无空格）", () => {
    // 复现 finding-1：当前 claude 全 alt-screen，banner 在 OSC 标题被 strip、logo 打散无空格、
    // "Using Opus" 不落 scrollback——纯去 ANSI 文本里没有可嗅探标记。
    const altScreenStripped =
      "ClaudeCode\n(base) PS C:\\Users\\zwm>\nsome program output";
    expect(sniffClaude(altScreenStripped)).toBe(false);
  });

  it("OSC 终端标题 'Claude Code' 进入嗅探文本即命中（finding-1 的修复信号）", () => {
    // observer 把 OSC 标题（"✳ Claude Code"，带空格）追加进嗅探文本。
    const withTitle = "ClaudeCode\n(base) PS>\n✳ Claude Code";
    expect(sniffClaude(withTitle)).toBe(true);
  });

  it("经典 banner 标记仍命中（Using Opus / Welcome to Claude Code）", () => {
    expect(sniffClaude("Using Opus 4.8 (1M context)")).toBe(true);
    expect(sniffClaude("Welcome to Claude Code")).toBe(true);
  });

  it("普通 shell scrollback 不误命中", () => {
    expect(sniffClaude("(base) PS C:\\Users\\zwm> git status\nnothing to commit")).toBe(
      false
    );
  });
});
