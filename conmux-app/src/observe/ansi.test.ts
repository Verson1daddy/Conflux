// ===== ansi.stripAnsi 单测（M⑤h §2）=====
//
// 剥离 CSI / OSC / 单 ESC 短序列，保留可见文本（含中文/Unicode 不坏）。
// 只去控制序列、不改可见字符（诚实：剥后仍是终端真打印的字符）。只测不改正则。

import { describe, expect, it } from "vitest";
import { stripAnsi, extractOscTitle } from "./ansi";

const ESC = "\x1b";
const BEL = "\x07";

describe("stripAnsi", () => {
  it("strips a CSI SGR color sequence, keeping the text", () => {
    expect(stripAnsi(`${ESC}[31mred${ESC}[0m`)).toBe("red");
  });

  it("strips CSI cursor-movement sequences", () => {
    expect(stripAnsi(`${ESC}[2J${ESC}[H${ESC}[5;10Hhello`)).toBe("hello");
  });

  it("strips an OSC sequence terminated by BEL", () => {
    expect(stripAnsi(`${ESC}]0;window title${BEL}body`)).toBe("body");
  });

  it("strips an OSC sequence terminated by ESC backslash (ST)", () => {
    expect(stripAnsi(`${ESC}]0;title${ESC}\\body`)).toBe("body");
  });

  it("strips short ESC sequences covered by SHORT_RE (ESC=, ESC>, ESC + @-Z)", () => {
    // SHORT_RE 字符类 [@-Z\\]^_a-z=><]：覆盖 ESC= / ESC> / ESC + 大写字母(如 ESCM)。
    // 注：ESC( / ESC) （charset 选择）不在该类内——属正则真值，不在此断言（勿改正则）。
    expect(stripAnsi(`${ESC}=abc${ESC}>def`)).toBe("abcdef");
    expect(stripAnsi(`${ESC}Mhello`)).toBe("hello");
  });

  it("preserves Chinese / Unicode visible text", () => {
    expect(stripAnsi(`${ESC}[32m进程已退出${ESC}[0m`)).toBe("进程已退出");
    expect(stripAnsi(`${ESC}[1m你好 ✻ 世界${ESC}[0m`)).toBe("你好 ✻ 世界");
  });

  it("leaves plain text with no escapes untouched", () => {
    expect(stripAnsi("(base) PS C:\\Users\\zwm> ls")).toBe(
      "(base) PS C:\\Users\\zwm> ls"
    );
  });

  it("strips mixed CSI + OSC in one buffer", () => {
    const buf = `${ESC}]0;t${BEL}${ESC}[33mUsing Opus 4.8 (1M context)${ESC}[0m`;
    expect(stripAnsi(buf)).toBe("Using Opus 4.8 (1M context)");
  });
});

describe("extractOscTitle (finding-1: OSC 标题嗅探 claude)", () => {
  it("extracts an OSC 0 title (BEL-terminated)", () => {
    expect(extractOscTitle(`${ESC}]0;✳ Claude Code${BEL}body`)).toBe(
      "✳ Claude Code"
    );
  });

  it("extracts an OSC 2 title (ST/ESC\\ terminated)", () => {
    expect(extractOscTitle(`${ESC}]2;My Title${ESC}\\rest`)).toBe("My Title");
  });

  it("returns the LAST title when several are set (claude 先 'claude' 后 '✳ Claude Code')", () => {
    const buf = `${ESC}]0;claude${BEL}logo${ESC}]0;✳ Claude Code${BEL}`;
    expect(extractOscTitle(buf)).toBe("✳ Claude Code");
  });

  it("ignores OSC 7 (cwd, 不是窗口标题)", () => {
    expect(extractOscTitle(`${ESC}]7;file:///c/Users/zwm${BEL}`)).toBeNull();
  });

  it("returns null when no OSC title present", () => {
    expect(extractOscTitle("plain (base) PS C:\\Users\\zwm> ls")).toBeNull();
  });
});
