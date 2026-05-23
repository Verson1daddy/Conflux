import { describe, expect, it } from "vitest";
import { shouldStopTerminalWheelPropagation } from "./terminal-wheel";

describe("terminal wheel routing", () => {
  it("keeps normal expanded-terminal scrolling local to xterm", () => {
    expect(
      shouldStopTerminalWheelPropagation(
        { ctrlKey: false, metaKey: false },
        true,
      ),
    ).toBe(true);
  });

  it("lets canvas zoom shortcuts pass through previews and modifier wheels", () => {
    expect(
      shouldStopTerminalWheelPropagation(
        { ctrlKey: true, metaKey: false },
        true,
      ),
    ).toBe(false);
    expect(
      shouldStopTerminalWheelPropagation(
        { ctrlKey: false, metaKey: true },
        true,
      ),
    ).toBe(false);
    expect(
      shouldStopTerminalWheelPropagation(
        { ctrlKey: false, metaKey: false },
        false,
      ),
    ).toBe(false);
  });
});
