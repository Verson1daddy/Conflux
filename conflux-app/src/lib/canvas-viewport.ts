import type { CardLayout } from "@/types";

interface CanvasViewportInput {
  cards: CardLayout[];
  pan: { x: number; y: number };
  zoom: number;
  viewportWidth: number;
  viewportHeight: number;
  slack?: number;
}

interface CanvasFitDecisionInput extends CanvasViewportInput {
  previousCardCount: number;
}

interface PinnedFilterInput {
  pinnedFilter: boolean;
  totalCardCount: number;
  knownCardCount: number;
  visiblePinnedCardCount: number;
}

interface FitCardsIntoViewportInput {
  cards: CardLayout[];
  viewportWidth: number;
  viewportHeight: number;
  minZoom?: number;
  maxZoom?: number;
  padding?: number;
}

interface FitCardsIntoViewportResult {
  zoom: number;
  pan: { x: number; y: number };
}

function isFiniteCard(card: CardLayout): boolean {
  return (
    Number.isFinite(card.position.x) &&
    Number.isFinite(card.position.y) &&
    Number.isFinite(card.size.width) &&
    Number.isFinite(card.size.height) &&
    card.size.width > 0 &&
    card.size.height > 0
  );
}

export function hasVisibleCardsInViewport(input: CanvasViewportInput): boolean {
  const slack = input.slack ?? 24;
  const zoom = Number.isFinite(input.zoom) && input.zoom > 0 ? input.zoom : 1;

  return input.cards.some((card) => {
    if (!isFiniteCard(card)) return false;

    const left = card.position.x * zoom + input.pan.x;
    const top = card.position.y * zoom + input.pan.y;
    const right = (card.position.x + card.size.width) * zoom + input.pan.x;
    const bottom = (card.position.y + card.size.height) * zoom + input.pan.y;

    return (
      right >= -slack &&
      bottom >= -slack &&
      left <= input.viewportWidth + slack &&
      top <= input.viewportHeight + slack
    );
  });
}

export function shouldFitCardsIntoViewport(
  input: CanvasFitDecisionInput,
): boolean {
  if (input.cards.length === 0) return false;

  if (input.previousCardCount === 0 && input.cards.length > 0) {
    return true;
  }

  if (input.previousCardCount > input.cards.length) {
    return !hasVisibleCardsInViewport(input);
  }

  return false;
}

export function shouldDisablePinnedFilter(input: PinnedFilterInput): boolean {
  return (
    input.pinnedFilter &&
    input.totalCardCount > 0 &&
    input.knownCardCount === input.totalCardCount &&
    input.visiblePinnedCardCount === 0
  );
}

export function fitCardsIntoViewport(
  input: FitCardsIntoViewportInput,
): FitCardsIntoViewportResult | null {
  const finiteCards = input.cards.filter(isFiniteCard);
  if (finiteCards.length === 0) return null;

  const padding = input.padding ?? 60;
  const minZoom = input.minZoom ?? 0.25;
  const maxZoom = input.maxZoom ?? 1;

  let minX = Infinity;
  let minY = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;

  for (const card of finiteCards) {
    minX = Math.min(minX, card.position.x);
    minY = Math.min(minY, card.position.y);
    maxX = Math.max(maxX, card.position.x + card.size.width);
    maxY = Math.max(maxY, card.position.y + card.size.height);
  }

  const bboxW = maxX - minX + padding * 2;
  const bboxH = maxY - minY + padding * 2;
  const zoom = Math.max(
    minZoom,
    Math.min(maxZoom, Math.min(input.viewportWidth / bboxW, input.viewportHeight / bboxH)),
  );
  const contentW = bboxW * zoom;
  const contentH = bboxH * zoom;
  const panX = (input.viewportWidth - contentW) / 2 - (minX - padding) * zoom;
  const panY = (input.viewportHeight - contentH) / 2 - (minY - padding) * zoom;

  return {
    zoom,
    pan: { x: panX, y: panY },
  };
}
