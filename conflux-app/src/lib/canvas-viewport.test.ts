import { describe, expect, it } from "vitest";
import {
  fitCardsIntoViewport,
  focusCardViewport,
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

describe("focusCardViewport（jump-back 聚焦）", () => {
  it("大卡片：居中且约占视口 60%", () => {
    const target: CardLayout = {
      instance_id: "a",
      position: { x: 100, y: 200 },
      size: { width: 800, height: 500 },
      z_index: 1,
    };
    const result = focusCardViewport(target, 1440, 900);
    expect(result).not.toBeNull();
    const { zoom, pan } = result!;
    // 卡片中心映射到视口中心
    expect((100 + 400) * zoom + pan.x).toBeCloseTo(720, 6);
    expect((200 + 250) * zoom + pan.y).toBeCloseTo(450, 6);
    // 覆盖率：缩放后的卡片约占视口 60%（800/1440 与 500/900 同比，1.08 未触 clamp）
    expect(zoom).toBeCloseTo(1.08, 2);
  });

  it("小卡片：zoom 被 2 上限钳住（不过度放大），仍居中", () => {
    const target: CardLayout = {
      instance_id: "a",
      position: { x: 100, y: 200 },
      size: { width: 320, height: 200 },
      z_index: 1,
    };
    const result = focusCardViewport(target, 1440, 900);
    expect(result).not.toBeNull();
    const { zoom, pan } = result!;
    expect(zoom).toBe(2);
    expect((100 + 160) * zoom + pan.x).toBeCloseTo(720, 6);
    expect((200 + 100) * zoom + pan.y).toBeCloseTo(450, 6);
  });

  it("非法卡片返回 null", () => {
    const broken: CardLayout = {
      instance_id: "a",
      position: { x: Number.NaN, y: 0 },
      size: { width: 0, height: 0 },
      z_index: 1,
    };
    expect(focusCardViewport(broken, 1440, 900)).toBeNull();
  });
});

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
