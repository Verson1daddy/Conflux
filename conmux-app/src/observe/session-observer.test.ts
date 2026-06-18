// ===== session-observer 纯函数单测（attention 真路由 BEL 检测）=====
//
// observer 的事件状态机（BEL/退出置 attention、ack 清除）依赖 Tauri 事件，按观测层
// 测试哲学走 e2e；此处单测可纯测的 BEL 检测核心。

import { describe, expect, it } from "vitest";
import { containsBel } from "./session-observer";

describe("containsBel (attention BEL 信号)", () => {
  it("检出嵌在输出中的 BEL", () => {
    expect(containsBel("done\x07")).toBe(true);
    expect(containsBel("\x07")).toBe(true);
    expect(containsBel("a\x07b")).toBe(true);
  });

  it("无 BEL → false", () => {
    expect(containsBel("")).toBe(false);
    expect(containsBel("plain output\n")).toBe(false);
    // 其它控制符（ESC/换行/制表）不误判为 BEL。
    expect(containsBel("\x1b[31mred\x1b[0m\n\t")).toBe(false);
  });
});
