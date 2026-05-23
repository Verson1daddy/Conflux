import { describe, expect, it } from "vitest";
import {
  fitCardsIntoViewport,
  hasVisibleCardsInViewport,
  shouldDisablePinnedFilter,
  shouldFitCardsIntoViewport,
} from "./canvas-viewport";
import type { CardLayout } from "@/types";

function card(
  instanceId: string,
  position: { x: number; y: number },
): CardLayout {
  return {
    instance_id: instanceId,
    position,
    size: { width: 320, height: 220 },
    z_index: 1,
  };
}

describe("canvas viewport recovery", () => {
  it("detects cards that intersect the current viewport", () => {
    expect(
      hasVisibleCardsInViewport({
        cards: [card("agent-1", { x: 24, y: 24 })],
        pan: { x: 0, y: 0 },
        zoom: 1,
        viewportWidth: 800,
        viewportHeight: 600,
      }),
    ).toBe(true);
  });

  it("detects when all cards have been pushed outside the viewport", () => {
    expect(
      hasVisibleCardsInViewport({
        cards: [
          card("agent-1", { x: 5_000, y: 5_000 }),
          card("agent-2", { x: 5_400, y: 5_000 }),
        ],
        pan: { x: 0, y: 0 },
        zoom: 1,
        viewportWidth: 800,
        viewportHeight: 600,
      }),
    ).toBe(false);
  });

  it("fits when live cards first restore into an empty canvas", () => {
    expect(
      shouldFitCardsIntoViewport({
        previousCardCount: 0,
        cards: [card("agent-1", { x: 5_000, y: 5_000 })],
        pan: { x: 0, y: 0 },
        zoom: 1,
        viewportWidth: 800,
        viewportHeight: 600,
      }),
    ).toBe(true);
  });

  it("fits after deletion if the remaining cards are all offscreen", () => {
    expect(
      shouldFitCardsIntoViewport({
        previousCardCount: 4,
        cards: [
          card("agent-1", { x: 5_000, y: 5_000 }),
          card("agent-2", { x: 5_400, y: 5_000 }),
          card("agent-3", { x: 5_800, y: 5_000 }),
        ],
        pan: { x: 0, y: 0 },
        zoom: 1,
        viewportWidth: 800,
        viewportHeight: 600,
      }),
    ).toBe(true);
  });

  it("does not steal the viewport after deletion if a remaining card is visible", () => {
    expect(
      shouldFitCardsIntoViewport({
        previousCardCount: 4,
        cards: [
          card("agent-1", { x: 24, y: 24 }),
          card("agent-2", { x: 5_000, y: 5_000 }),
          card("agent-3", { x: 5_400, y: 5_000 }),
        ],
        pan: { x: 0, y: 0 },
        zoom: 1,
        viewportWidth: 800,
        viewportHeight: 600,
      }),
    ).toBe(false);
  });

  it("fails open when pinned filtering would hide every remaining card", () => {
    expect(
      shouldDisablePinnedFilter({
        pinnedFilter: true,
        totalCardCount: 3,
        knownCardCount: 3,
        visiblePinnedCardCount: 0,
      }),
    ).toBe(true);
  });

  it("keeps pinned filtering when at least one pinned card is visible", () => {
    expect(
      shouldDisablePinnedFilter({
        pinnedFilter: true,
        totalCardCount: 3,
        knownCardCount: 3,
        visiblePinnedCardCount: 1,
      }),
    ).toBe(false);
  });

  it("keeps pinned filtering while card metadata is still hydrating", () => {
    expect(
      shouldDisablePinnedFilter({
        pinnedFilter: true,
        totalCardCount: 3,
        knownCardCount: 2,
        visiblePinnedCardCount: 0,
      }),
    ).toBe(false);
  });

  it("fits the provided subset instead of hidden distant cards", () => {
    const visiblePinned = card("pinned", { x: 5_000, y: 5_000 });
    const hiddenFarAway = card("hidden-unpinned", { x: 100_000, y: 100_000 });
    const fullFit = fitCardsIntoViewport({
      cards: [visiblePinned, hiddenFarAway],
      viewportWidth: 800,
      viewportHeight: 600,
    });
    const subsetFit = fitCardsIntoViewport({
      cards: [visiblePinned],
      viewportWidth: 800,
      viewportHeight: 600,
    });

    expect(fullFit).not.toBeNull();
    expect(subsetFit).not.toBeNull();
    expect(
      hasVisibleCardsInViewport({
        cards: [visiblePinned],
        pan: fullFit!.pan,
        zoom: fullFit!.zoom,
        viewportWidth: 800,
        viewportHeight: 600,
      }),
    ).toBe(false);
    expect(
      hasVisibleCardsInViewport({
        cards: [visiblePinned],
        pan: subsetFit!.pan,
        zoom: subsetFit!.zoom,
        viewportWidth: 800,
        viewportHeight: 600,
      }),
    ).toBe(true);
  });
});
