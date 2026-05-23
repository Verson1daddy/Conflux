import type { IslandMode } from "@/types";

const ISLAND_MODES = new Set<IslandMode>([
  "top_island",
  "sidebar",
  "float_ball",
]);

interface StorageReader {
  getItem: (key: string) => string | null;
}

export function isIslandMode(value: unknown): value is IslandMode {
  return typeof value === "string" && ISLAND_MODES.has(value as IslandMode);
}

export function readPersistedIslandMode(
  storage: StorageReader = localStorage,
): IslandMode | null {
  try {
    const value = storage.getItem("conflux.islandMode");
    return isIslandMode(value) ? value : null;
  } catch {
    return null;
  }
}

export function shouldApplyBackendIslandModeHydration(input: {
  persistedMode: IslandMode | null;
  backendMode: IslandMode;
}): boolean {
  return input.persistedMode === null || input.persistedMode === input.backendMode;
}
