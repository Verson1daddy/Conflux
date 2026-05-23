import { describe, expect, it } from "vitest";
import { TOP_BAR_COMPACT_MODE } from "./workspace-compact-mode";

describe("workspace compact mode shortcuts", () => {
  it("uses the sidebar for TopBar compact shortcuts", () => {
    expect(TOP_BAR_COMPACT_MODE).toBe("sidebar");
  });
});
