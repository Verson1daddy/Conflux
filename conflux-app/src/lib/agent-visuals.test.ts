import { describe, expect, it } from "vitest";
import {
  adapterIdentityColor,
  DEFAULT_CARD_ACCENT_COLOR,
  resolveCardAccentColor,
  resolveCardStatusMeta,
} from "./agent-visuals";

describe("agent visuals", () => {
  it("keeps adapter identity color separate from default card accent", () => {
    const emptyCardColors = new Map<string, string>();

    expect(adapterIdentityColor("claude-code")).not.toBe(adapterIdentityColor("codex"));
    expect(resolveCardAccentColor("claude-1", emptyCardColors)).toBe(DEFAULT_CARD_ACCENT_COLOR);
    expect(resolveCardAccentColor("codex-1", emptyCardColors)).toBe(DEFAULT_CARD_ACCENT_COLOR);
  });

  it("lets user-selected card colors override the neutral default per instance", () => {
    const cardColors = new Map<string, string>([["codex-1", "#FFB800"]]);

    expect(resolveCardAccentColor("codex-1", cardColors)).toBe("#FFB800");
    expect(resolveCardAccentColor("codex-2", cardColors)).toBe(DEFAULT_CARD_ACCENT_COLOR);
  });

  it("maps runtime status to status-specific labels and colors", () => {
    expect(resolveCardStatusMeta("coding")).toMatchObject({
      label: "Coding",
      color: "#34C759",
    });
    expect(resolveCardStatusMeta("waiting_permission")).toMatchObject({
      label: "Approval",
      color: "#FFB800",
    });
  });
});
