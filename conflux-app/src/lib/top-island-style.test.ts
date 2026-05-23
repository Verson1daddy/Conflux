import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const css = readFileSync(new URL("../index.css", import.meta.url), "utf8");
const indexHtml = readFileSync(new URL("../../index.html", import.meta.url), "utf8");

function topIslandCapsuleBlocks(): string[] {
  return Array.from(
    css.matchAll(/[^{}]*\.top-island-capsule(?![_-])(?:\[[^\]]+\])?[^{}]*\{[^}]*\}/g),
    (match) => match[0],
  );
}

function sharedCapsuleShadowDeclaration(): string {
  return css.match(/--surface-capsule-shadow:\s*([\s\S]*?);/)?.[1] ?? "";
}

function cssBlocksFor(selector: string): string[] {
  const escapedSelector = selector.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  return Array.from(
    css.matchAll(new RegExp(`${escapedSelector}\\s*\\{[^}]*\\}`, "g")),
    (match) => match[0],
  );
}

function floatBallBlocks(): string[] {
  return Array.from(
    css.matchAll(/[^{}]*\.float-ball(?![_-])(?:\[[^\]]+\])?[^{}]*\{[^}]*\}/g),
    (match) => match[0],
  );
}

function findLastBlock(blocks: string[], predicate: (block: string) => boolean): string {
  return [...blocks].reverse().find(predicate) ?? "";
}

function reducedMotionBlock(): string {
  return css.match(/@media \(prefers-reduced-motion: reduce\)\s*\{[\s\S]*$/)?.[0] ?? "";
}

describe("top island capsule styling", () => {
  it("marks compact windows before first paint so the initial HTML frame is transparent", () => {
    const bootstrapHintIndex = indexHtml.indexOf("confluxWindow");
    const styleIndex = indexHtml.indexOf("<style>");

    expect(bootstrapHintIndex).toBeGreaterThan(-1);
    expect(styleIndex).toBeGreaterThan(-1);
    expect(bootstrapHintIndex).toBeLessThan(styleIndex);
    expect(indexHtml).toMatch(
      /html\[data-window-label="island"\][\s\S]*background:\s*transparent\s*!important/,
    );
    expect(indexHtml).toMatch(
      /html\[data-window-label="float_panel"\][\s\S]*background:\s*transparent\s*!important/,
    );
  });

  it("keeps the final shell padding inside the native viewport contract", () => {
    const shellBlocks = cssBlocksFor(".top-island-shell");
    const finalShellBlock = findLastBlock(shellBlocks, (block) =>
      block.includes("--top-island-shell-padding-y")
    );

    expect(finalShellBlock).toMatch(/box-sizing:\s*border-box/);
    expect(finalShellBlock).toMatch(
      /padding-block:\s*var\(--top-island-shell-padding-y,\s*8px\)/
    );
  });

  it("does not use blue or amber outer glow", () => {
    expect(topIslandCapsuleBlocks().join("\n")).not.toMatch(
      /0\s+0\s+\d+px\s+rgba\((?:184,\s*212,\s*227|255,\s*184,\s*0)/,
    );
  });

  it("keeps the final top island capsule free of outer drop shadows", () => {
    const finalCapsuleBlock = findLastBlock(topIslandCapsuleBlocks(), (block) =>
      block.includes("box-shadow")
    );

    expect(finalCapsuleBlock).toMatch(/box-shadow:\s*inset/);
    expect(finalCapsuleBlock).not.toMatch(/rgba\(0,\s*0,\s*0/);
  });

  it("slows the final capsule resize without animating shadow frames", () => {
    const readyCapsuleBlock = findLastBlock(topIslandCapsuleBlocks(), (block) =>
      block.includes("width 420ms")
    );
    const notReadyCapsuleBlock = findLastBlock(topIslandCapsuleBlocks(), (block) =>
      block.includes('[data-island-ready="false"]')
    );

    expect(readyCapsuleBlock).toMatch(/width\s+420ms\s+var\(--ease-apple\)/);
    expect(readyCapsuleBlock).toMatch(/height\s+420ms\s+var\(--ease-apple\)/);
    expect(readyCapsuleBlock).not.toMatch(/box-shadow\s+[^,;]+/);
    expect(notReadyCapsuleBlock).not.toMatch(/width\s+420ms/);
    expect(notReadyCapsuleBlock).not.toMatch(/height\s+420ms/);
  });

  it("disables the shell enter animation that can flash a native-window frame", () => {
    const shellModeBlocks = cssBlocksFor('.island-shell[data-mode="top_island"]');
    const finalShellModeBlock = findLastBlock(shellModeBlocks, (block) =>
      block.includes("animation:")
    );

    expect(finalShellModeBlock).toMatch(/animation:\s*none/);
  });

  it("keeps the shared capsule shadow neutral", () => {
    expect(sharedCapsuleShadowDeclaration()).not.toMatch(
      /rgba\((?:184,\s*212,\s*227|255,\s*184,\s*0)/,
    );
  });

  it("keeps the island WebView from exposing page scrollbars", () => {
    const islandWindowBlock =
      css.match(
        /html\[data-window-label="island"\],[\s\S]*?html\[data-window-label="float_panel"\] #root\s*\{[^}]*\}/,
      )?.[0] ?? "";

    expect(islandWindowBlock).toMatch(/overflow:\s*hidden/);
  });

  it("lets the final top island popover size to content without its own scrollbar", () => {
    const popoverBlocks = cssBlocksFor(".top-island-popover.top-island-bubble");
    const finalPopoverBlock = findLastBlock(popoverBlocks, (block) =>
      block.includes("--top-island-popover-width")
    );

    expect(finalPopoverBlock).toMatch(
      /width:\s*var\(--top-island-popover-width,\s*232px\)/
    );
    expect(finalPopoverBlock).toMatch(/height:\s*auto/);
    expect(finalPopoverBlock).toMatch(/max-height:\s*none/);
    expect(finalPopoverBlock).toMatch(/overflow:\s*visible/);
    expect(finalPopoverBlock).not.toMatch(/overflow-y:\s*auto/);
    expect(finalPopoverBlock).not.toMatch(/radial-gradient/);
    expect(finalPopoverBlock).not.toMatch(/rgba\(184,\s*212,\s*227/);
    expect(finalPopoverBlock).not.toMatch(/rgba\(0,\s*0,\s*0/);
  });

  it("keeps long top island popover content scrollable without exposing a scrollbar", () => {
    const bodyBlocks = cssBlocksFor(".top-island-bubble__body");
    const finalBodyBlock = findLastBlock(bodyBlocks, (block) =>
      block.includes("--top-island-popover-body-max-height")
    );
    const webkitBlock =
      css.match(/\.top-island-bubble__body::-webkit-scrollbar\s*\{[^}]*\}/)?.[0] ?? "";

    expect(finalBodyBlock).toMatch(
      /max-height:\s*var\(--top-island-popover-body-max-height,\s*320px\)/
    );
    expect(finalBodyBlock).toMatch(/overflow-y:\s*auto/);
    expect(finalBodyBlock).toMatch(/scrollbar-width:\s*none/);
    expect(webkitBlock).toMatch(/display:\s*none/);
  });
});

describe("compact float ball styling", () => {
  it("uses a dedicated anchored panel animation instead of the generic compact pop", () => {
    const keyframes = css.match(/@keyframes float-ball-panel-enter\s*\{[\s\S]*?\n\}/)?.[0] ?? "";
    const panelBlocks = cssBlocksFor(".float-ball-panel");
    const animatedPanelBlock = findLastBlock(panelBlocks, (block) =>
      block.includes("float-ball-panel-enter")
    );

    expect(keyframes).toContain("translate3d");
    expect(keyframes).toContain("scale");
    expect(keyframes).not.toContain("1.012");
    expect(animatedPanelBlock).toMatch(/animation:\s*float-ball-panel-enter/);
    expect(animatedPanelBlock).toMatch(
      /transform-origin:\s*calc\(100% - 44px\)\s+calc\(100% - 24px\)/,
    );
    expect(animatedPanelBlock).not.toMatch(/calc\(100% \+ \d+px\)/);
  });

  it("keeps the final float ball shell from replaying an enter animation on click", () => {
    const shellModeBlocks = cssBlocksFor('.island-shell[data-mode="float_ball"]');
    const finalShellModeBlock = findLastBlock(shellModeBlocks, (block) =>
      block.includes("animation:")
    );

    expect(finalShellModeBlock).toMatch(/animation:\s*none/);
  });

  it("keeps the final float ball base state stable while allowing press feedback", () => {
    const ballBlocks = floatBallBlocks();
    const finalBallBlock = findLastBlock(ballBlocks, (block) => block.includes("will-change"));
    const activeBlocks = cssBlocksFor(".float-ball:active");
    const finalActiveBlock = findLastBlock(activeBlocks, (block) => block.includes("transform:"));

    expect(finalBallBlock).toMatch(/transform:\s*none/);
    expect(finalBallBlock).toMatch(/transition:[\s\S]*transform\s+180ms/);
    expect(finalBallBlock).toMatch(/will-change:\s*transform/);
    expect(finalActiveBlock).toMatch(/transform:\s*scale\(0\.96\)/);
    expect(finalActiveBlock).not.toMatch(/translateY\(-/);
    expect(finalActiveBlock).toMatch(/transition-duration:\s*120ms/);
  });

  it("centers the final float ball inside its padded native transparent viewport", () => {
    const shellBlocks = cssBlocksFor(".float-ball-shell");
    const finalShellBlock = findLastBlock(shellBlocks, (block) =>
      block.includes("place-items: center")
    );

    expect(finalShellBlock).toMatch(/display:\s*grid/);
    expect(finalShellBlock).toMatch(/place-items:\s*center/);
    expect(finalShellBlock).toMatch(
      /padding:\s*var\(--float-ball-window-padding,\s*6px\)/,
    );
  });

  it("overrides the shared pressable lift with scale-only feedback so the ball cannot clip", () => {
    const guardedBlocks = cssBlocksFor(".float-ball.island-pressable:hover:not(:disabled)");
    const guardedHoverBlock = findLastBlock(guardedBlocks, (block) =>
      block.includes("transform:")
    );

    expect(guardedHoverBlock).toMatch(/transform:\s*scale\(1\.03\)/);
    expect(guardedHoverBlock).not.toMatch(/translateY\(-/);
  });

  it("renders the sidebar collapsed state as a bounded dock tab", () => {
    const hotzoneBlocks = cssBlocksFor(".sidebar-hotzone");
    const finalHotzoneBlock = findLastBlock(hotzoneBlocks, (block) =>
      block.includes("--sidebar-dock-tab-width")
    );

    expect(finalHotzoneBlock).toMatch(/width:\s*var\(--sidebar-dock-tab-width,\s*48px\)/);
    expect(finalHotzoneBlock).toMatch(/height:\s*var\(--sidebar-dock-tab-height,\s*260px\)/);
    expect(finalHotzoneBlock).not.toMatch(/bottom:\s*0/);
    expect(finalHotzoneBlock).not.toMatch(/height:\s*100%/);
  });

  it("hides the decorative panel anchor so it cannot create colored glow", () => {
    const anchorBlocks = cssBlocksFor(".float-ball-panel__anchor");
    const finalAnchorBlock = findLastBlock(anchorBlocks, (block) => block.includes("display: none"));

    expect(finalAnchorBlock).toMatch(/display:\s*none/);
  });

  it("keeps the final float panel shadow neutral", () => {
    const panelBlocks = cssBlocksFor(".float-ball-panel");
    const finalPanelBlock = findLastBlock(panelBlocks, (block) => block.includes("overflow-y: auto"));

    expect(finalPanelBlock).not.toMatch(
      /rgba\((?:184,\s*212,\s*227|255,\s*184,\s*0)/,
    );
  });

  it("lays out the separate float panel window without relying on the ball offset", () => {
    const panelWindowBlocks = cssBlocksFor('body[data-window-label="float_panel"] .float-ball-panel');
    const finalPanelWindowBlock = findLastBlock(panelWindowBlocks, (block) =>
      block.includes("width: 100vw")
    );

    expect(finalPanelWindowBlock).toMatch(/right:\s*0/);
    expect(finalPanelWindowBlock).toMatch(/bottom:\s*0/);
    expect(finalPanelWindowBlock).toMatch(/width:\s*100vw/);
    expect(finalPanelWindowBlock).toMatch(/max-height:\s*100vh/);
  });

  it("restores the float panel specific animation after the generic compact detail rule", () => {
    const panelDetailBlocks = cssBlocksFor(".float-ball-panel.compact-detail");
    const finalPanelDetailBlock = findLastBlock(panelDetailBlocks, (block) =>
      block.includes("float-ball-panel-settle")
    );
    const settleKeyframes =
      css.match(/@keyframes float-ball-panel-settle\s*\{[\s\S]*?\n\}/)?.[0] ?? "";

    expect(finalPanelDetailBlock).toMatch(/animation:\s*float-ball-panel-settle/);
    expect(settleKeyframes).toContain("translate3d");
    expect(settleKeyframes).not.toMatch(/opacity:\s*0/);
  });

  it("keeps reduced motion from running the float panel animation", () => {
    const block = reducedMotionBlock();

    expect(block).toMatch(/\.float-ball,\s*\n\s*\.float-ball-panel/);
    expect(block).toMatch(/animation:\s*none/);
    expect(block).toMatch(/transition-duration:\s*1ms/);
  });
});
