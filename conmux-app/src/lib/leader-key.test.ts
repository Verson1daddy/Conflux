// ===== leader-key 配置单测（可配置化 2026-06-19）=====
//
// 验证 veto 不变量（必须带 Ctrl/Alt）、精确修饰键匹配、leader-leader 字面、标签、持久 round-trip。

import { beforeEach, describe, expect, it } from "vitest";
import {
  DEFAULT_LEADER,
  directNavDir,
  directPaneCmd,
  formatLeaderLabel,
  getDirectShortcuts,
  getLeaderChord,
  isValidChord,
  leaderLiteral,
  matchesLeaderChord,
  resetLeaderChord,
  setDirectShortcuts,
  setLeaderChord,
  type LeaderChord,
} from "./leader-key";

const ev = (
  over: Partial<{
    ctrlKey: boolean;
    altKey: boolean;
    shiftKey: boolean;
    metaKey: boolean;
    code: string;
    key: string;
  }> = {}
) => ({
  ctrlKey: false,
  altKey: false,
  shiftKey: false,
  metaKey: false,
  code: "Space",
  key: " ",
  ...over,
});

beforeEach(() => resetLeaderChord());

describe("isValidChord (veto 不变量)", () => {
  it("接受带 Ctrl 或 Alt 的合法 chord", () => {
    expect(isValidChord({ ctrl: true, alt: false, code: "Space", key: " " })).toBe(true);
    expect(isValidChord({ ctrl: false, alt: true, code: "KeyK", key: "k" })).toBe(true);
  });
  it("拒绝无修饰键（裸键会弄坏 CLI）", () => {
    expect(isValidChord({ ctrl: false, alt: false, code: "KeyA", key: "a" })).toBe(false);
  });
  it("拒绝纯修饰键作前缀键", () => {
    expect(isValidChord({ ctrl: true, alt: false, code: "ControlLeft", key: "Control" })).toBe(false);
  });
  it("拒绝坏形状", () => {
    expect(isValidChord(null)).toBe(false);
    expect(isValidChord({ ctrl: true })).toBe(false);
    expect(isValidChord({ ctrl: true, alt: false, code: "", key: "" })).toBe(false);
  });
});

describe("matchesLeaderChord (精确修饰键)", () => {
  const ctrlSpace: LeaderChord = { ctrl: true, alt: false, code: "Space", key: " " };
  it("Ctrl+Space 命中 Ctrl+Space 配置", () => {
    expect(matchesLeaderChord(ev({ ctrlKey: true }), ctrlSpace)).toBe(true);
  });
  it("Ctrl+Shift+Space 不命中（shift 必须未按）", () => {
    expect(matchesLeaderChord(ev({ ctrlKey: true, shiftKey: true }), ctrlSpace)).toBe(false);
  });
  it("裸 Space 不命中（缺 Ctrl）", () => {
    expect(matchesLeaderChord(ev({}), ctrlSpace)).toBe(false);
  });
  it("Alt+K 命中 Alt+K 配置（且 code 匹配）", () => {
    const altK: LeaderChord = { ctrl: false, alt: true, code: "KeyK", key: "k" };
    expect(matchesLeaderChord(ev({ altKey: true, code: "KeyK", key: "k" }), altK)).toBe(true);
    expect(matchesLeaderChord(ev({ ctrlKey: true, code: "KeyK", key: "k" }), altK)).toBe(false);
  });
});

describe("leaderLiteral (send-prefix 字面)", () => {
  it("Ctrl+Space → NUL", () => {
    expect(leaderLiteral({ ctrl: true, alt: false, code: "Space", key: " " })).toBe("\x00");
  });
  it("Ctrl+B → 0x02", () => {
    expect(leaderLiteral({ ctrl: true, alt: false, code: "KeyB", key: "b" })).toBe("\x02");
  });
  it("Ctrl+A → 0x01", () => {
    expect(leaderLiteral({ ctrl: true, alt: false, code: "KeyA", key: "a" })).toBe("\x01");
  });
  it("Alt+K → ESC + k", () => {
    expect(leaderLiteral({ ctrl: false, alt: true, code: "KeyK", key: "k" })).toBe("\x1bk");
  });
  it("不可表示（Ctrl+Alt+Space）→ 空串（no-op）", () => {
    expect(leaderLiteral({ ctrl: true, alt: true, code: "Space", key: " " })).toBe("");
  });
});

describe("formatLeaderLabel", () => {
  it("各组合标签", () => {
    expect(formatLeaderLabel({ ctrl: true, alt: false, code: "Space", key: " " })).toBe("⌃Space");
    expect(formatLeaderLabel({ ctrl: true, alt: false, code: "KeyB", key: "b" })).toBe("⌃B");
    expect(formatLeaderLabel({ ctrl: false, alt: true, code: "KeyK", key: "k" })).toBe("⌥K");
    expect(formatLeaderLabel({ ctrl: true, alt: true, code: "Digit1", key: "1" })).toBe("⌃⌥1");
  });
});

describe("set/get/reset (内存 round-trip)", () => {
  it("默认 = Ctrl+B（旧 Ctrl+Space 撞中文输入法已改）", () => {
    expect(getLeaderChord()).toEqual(DEFAULT_LEADER);
    expect(DEFAULT_LEADER).toEqual({ ctrl: true, alt: false, code: "KeyB", key: "b" });
  });
  it("set 合法值生效；非法值被忽略", () => {
    setLeaderChord({ ctrl: true, alt: false, code: "KeyB", key: "b" });
    expect(getLeaderChord().code).toBe("KeyB");
    setLeaderChord({ ctrl: false, alt: false, code: "KeyA", key: "a" }); // 无修饰 → 忽略
    expect(getLeaderChord().code).toBe("KeyB");
  });
  it("reset 回默认", () => {
    setLeaderChord({ ctrl: false, alt: true, code: "KeyK", key: "k" });
    resetLeaderChord();
    expect(getLeaderChord()).toEqual(DEFAULT_LEADER);
  });
});

describe("直接快捷键（opt-in）", () => {
  const dev = (
    over: Partial<{ ctrlKey: boolean; altKey: boolean; shiftKey: boolean; metaKey: boolean; code: string }> = {}
  ) => ({ ctrlKey: false, altKey: false, shiftKey: false, metaKey: false, code: "KeyH", ...over });

  it("默认 OFF（守 veto）", () => {
    setDirectShortcuts(false);
    expect(getDirectShortcuts()).toBe(false);
  });

  it("set true/false 生效", () => {
    setDirectShortcuts(true);
    expect(getDirectShortcuts()).toBe(true);
    setDirectShortcuts(false);
    expect(getDirectShortcuts()).toBe(false);
  });

  it("directNavDir：Ctrl+Alt+H/J/K/L → vim 方向", () => {
    expect(directNavDir(dev({ ctrlKey: true, altKey: true, code: "KeyH" }))).toBe("left");
    expect(directNavDir(dev({ ctrlKey: true, altKey: true, code: "KeyJ" }))).toBe("down");
    expect(directNavDir(dev({ ctrlKey: true, altKey: true, code: "KeyK" }))).toBe("up");
    expect(directNavDir(dev({ ctrlKey: true, altKey: true, code: "KeyL" }))).toBe("right");
  });

  it("directNavDir：缺修饰键 / 带 shift / 非 HJKL → null", () => {
    expect(directNavDir(dev({ ctrlKey: true, altKey: false, code: "KeyH" }))).toBeNull(); // 缺 Alt
    expect(directNavDir(dev({ ctrlKey: false, altKey: true, code: "KeyH" }))).toBeNull(); // 缺 Ctrl
    expect(directNavDir(dev({ ctrlKey: true, altKey: true, shiftKey: true, code: "KeyH" }))).toBeNull();
    expect(directNavDir(dev({ ctrlKey: true, altKey: true, code: "KeyG" }))).toBeNull();
  });

  it("directNavDir：真 AltGr（intl 组字符）→ null，不拦（红队 S-1）", () => {
    expect(
      directNavDir({
        ...dev({ ctrlKey: true, altKey: true, code: "KeyH" }),
        getModifierState: (k) => k === "AltGraph",
      })
    ).toBeNull();
    // 非 AltGr 的真 Ctrl+Alt（getModifierState 返 false）→ 仍命中。
    expect(
      directNavDir({
        ...dev({ ctrlKey: true, altKey: true, code: "KeyL" }),
        getModifierState: () => false,
      })
    ).toBe("right");
  });

  it("directPaneCmd：Ctrl+Alt+\\ / - / Z → 竖切/横切/缩放", () => {
    expect(directPaneCmd(dev({ ctrlKey: true, altKey: true, code: "Backslash" }))).toBe("split-v");
    expect(directPaneCmd(dev({ ctrlKey: true, altKey: true, code: "Minus" }))).toBe("split-h");
    expect(directPaneCmd(dev({ ctrlKey: true, altKey: true, code: "KeyZ" }))).toBe("zoom");
  });

  it("directPaneCmd：缺修饰键 / shift / 非这三键 / 真 AltGr → null", () => {
    expect(directPaneCmd(dev({ ctrlKey: true, altKey: false, code: "Backslash" }))).toBeNull();
    expect(directPaneCmd(dev({ ctrlKey: true, altKey: true, shiftKey: true, code: "Backslash" }))).toBeNull();
    expect(directPaneCmd(dev({ ctrlKey: true, altKey: true, code: "KeyH" }))).toBeNull(); // HJKL 归 nav
    expect(
      directPaneCmd({
        ...dev({ ctrlKey: true, altKey: true, code: "Backslash" }),
        getModifierState: (k) => k === "AltGraph",
      })
    ).toBeNull();
  });
});
