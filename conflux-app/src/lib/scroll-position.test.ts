// ===== 批3 §7：讨论流 sticky-bottom 判定 =====
// 纯函数：用户在底部（含松弛带）才允许新消息自动滚底，上翻阅读不被劫持。

import { describe, expect, it } from "vitest";

import { isScrolledNearBottom } from "./scroll-position";

describe("isScrolledNearBottom", () => {
  it("treats an exactly-bottom viewport as sticky", () => {
    expect(
      isScrolledNearBottom({ scrollTop: 600, clientHeight: 400, scrollHeight: 1000 }, 48)
    ).toBe(true);
  });

  it("stays sticky within the slack band", () => {
    expect(
      isScrolledNearBottom({ scrollTop: 560, clientHeight: 400, scrollHeight: 1000 }, 48)
    ).toBe(true);
  });

  it("releases stickiness once the user scrolls past the slack band", () => {
    expect(
      isScrolledNearBottom({ scrollTop: 100, clientHeight: 400, scrollHeight: 1000 }, 48)
    ).toBe(false);
  });

  it("is sticky when content is shorter than the viewport", () => {
    expect(
      isScrolledNearBottom({ scrollTop: 0, clientHeight: 400, scrollHeight: 200 }, 48)
    ).toBe(true);
  });

  it("honors a zero slack band strictly", () => {
    expect(
      isScrolledNearBottom({ scrollTop: 599, clientHeight: 400, scrollHeight: 1000 }, 0)
    ).toBe(false);
    expect(
      isScrolledNearBottom({ scrollTop: 600, clientHeight: 400, scrollHeight: 1000 }, 0)
    ).toBe(true);
  });
});
