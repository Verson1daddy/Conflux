// ===== osc7.parseOsc7Cwd 单测（M⑤h §2，保留 M3-ext 实证真值，勿改正则）=====
//
// 合法 OSC7 → 解析出 cwd（percent-decode、去 file://host、Windows file:///C:/ 去前导 /）；
// 非法 / 缺失 / 不完整 → null（诚实：不猜不编）。期望值锚定 M3-ext 已验证行为，只测不改逻辑。

import { describe, expect, it } from "vitest";
import { parseOsc7Cwd } from "./osc7";

const ESC = "\x1b";
const BEL = "\x07";

/** ESC ] 7 ; <payload> <ST>，ST = ESC\ 或 BEL。 */
function osc7(payload: string, st: "esc" | "bel" = "esc"): string {
  return `${ESC}]7;${payload}${st === "esc" ? `${ESC}\\` : BEL}`;
}

describe("parseOsc7Cwd", () => {
  it("parses a standard POSIX file://host/path payload", () => {
    expect(parseOsc7Cwd(osc7("file://host/home/zwm"))).toBe("/home/zwm");
  });

  it("parses file:///path with empty host", () => {
    expect(parseOsc7Cwd(osc7("file:///home/zwm"))).toBe("/home/zwm");
  });

  it("restores a Windows drive path from file:///C:/...", () => {
    expect(parseOsc7Cwd(osc7("file:///C:/Users/zwm"))).toBe("C:/Users/zwm");
  });

  it("percent-decodes a path with spaces", () => {
    expect(parseOsc7Cwd(osc7("file:///C:/Program%20Files/x"))).toBe(
      "C:/Program Files/x"
    );
  });

  it("accepts the BEL terminator variant", () => {
    expect(parseOsc7Cwd(osc7("file:///home/zwm", "bel"))).toBe("/home/zwm");
  });

  it("accepts a bare POSIX path payload (no file:// scheme)", () => {
    expect(parseOsc7Cwd(osc7("/var/log"))).toBe("/var/log");
  });

  it("accepts a bare Windows path payload", () => {
    expect(parseOsc7Cwd(osc7("D:\\work"))).toBe("D:\\work");
  });

  it("returns the latest cwd when multiple OSC7 sequences are present", () => {
    const buf = osc7("file:///home/a") + "noise" + osc7("file:///home/b");
    expect(parseOsc7Cwd(buf)).toBe("/home/b");
  });

  it("returns null when no OSC7 sequence is present", () => {
    expect(parseOsc7Cwd("just plain output\n")).toBeNull();
  });

  it("returns null for an incomplete OSC7 (no string terminator)", () => {
    expect(parseOsc7Cwd(`${ESC}]7;file:///home/zwm`)).toBeNull();
  });

  it("returns null for an unrecognized payload shape (does not guess)", () => {
    expect(parseOsc7Cwd(osc7("http://example.com"))).toBeNull();
    expect(parseOsc7Cwd(osc7("garbage-no-path"))).toBeNull();
  });

  it("returns null for file://host with no path slash", () => {
    expect(parseOsc7Cwd(osc7("file://host"))).toBeNull();
  });
});
