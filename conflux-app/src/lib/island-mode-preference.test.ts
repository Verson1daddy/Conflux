import { describe, expect, it, vi } from "vitest";

function storageWith(value: string | null) {
  return {
    getItem: vi.fn(() => value),
  };
}

describe("island mode preference", () => {
  it("keeps a stored sidebar preference authoritative during workspace hydration", async () => {
    const {
      readPersistedIslandMode,
      shouldApplyBackendIslandModeHydration,
    } = await import("./island-mode-preference");

    const persistedMode = readPersistedIslandMode(storageWith("sidebar"));

    expect(persistedMode).toBe("sidebar");
    expect(
      shouldApplyBackendIslandModeHydration({
        persistedMode,
        backendMode: "top_island",
      })
    ).toBe(false);
  });

  it("accepts backend hydration when there is no stored mode", async () => {
    const {
      readPersistedIslandMode,
      shouldApplyBackendIslandModeHydration,
    } = await import("./island-mode-preference");

    const persistedMode = readPersistedIslandMode(storageWith(null));

    expect(persistedMode).toBeNull();
    expect(
      shouldApplyBackendIslandModeHydration({
        persistedMode,
        backendMode: "sidebar",
      })
    ).toBe(true);
  });
});
