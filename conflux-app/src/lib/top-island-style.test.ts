import { describe, expect, it } from "vitest";

declare const require: {
  (id: "node:fs"): {
    readFileSync(path: URL, encoding: "utf8"): string;
  };
};

const { readFileSync } = require("node:fs");

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

function cssBlocksContaining(selector: string): string {
  return cssBlocksFor(selector).join("\n");
}

function findLastBlock(blocks: string[], predicate: (block: string) => boolean): string {
  return [...blocks].reverse().find(predicate) ?? "";
}

function capsulePulseBlock(): string {
  const start = css.indexOf("@keyframes capsule-pulse");
  const keyframes = start === -1 ? "" : css.slice(start, css.indexOf(".capsule-pulse", start));
  const classBlock = css.match(/\.capsule-pulse\s*\{[^}]*\}/)?.[0] ?? "";
  return `${keyframes}\n${classBlock}`;
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

  it("keeps the final top island capsule on the frozen black pill geometry", () => {
    const finalCapsuleBlock = findLastBlock(topIslandCapsuleBlocks(), (block) =>
      block.includes("--top-island-width") && block.includes("--top-island-height")
    );

    expect(finalCapsuleBlock).toMatch(/width:\s*var\(--top-island-width\)/);
    expect(finalCapsuleBlock).toMatch(/min-width:\s*var\(--top-island-width\)/);
    expect(finalCapsuleBlock).toMatch(/height:\s*var\(--top-island-height\)/);
    expect(finalCapsuleBlock).toMatch(/min-height:\s*var\(--top-island-height\)/);
    expect(finalCapsuleBlock).toMatch(/border-radius:\s*999px/);
    expect(finalCapsuleBlock).toMatch(/background:\s*#000000/);
  });

  it("does not use blue or amber outer glow", () => {
    expect(topIslandCapsuleBlocks().join("\n")).not.toMatch(
      /0\s+0\s+\d+px\s+rgba\((?:184,\s*212,\s*227|255,\s*184,\s*0)/,
    );
  });

  it("does not keep a reusable amber capsule pulse glow", () => {
    expect(capsulePulseBlock()).not.toMatch(
      /0\s+0\s+\d+px\s+rgba\(255,\s*184,\s*0/,
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

  it("keeps Conflux brand mark styling available for compact island surfaces", () => {
    expect(css).toContain("conflux-brand-mark");
    expect(css).toContain("top-island-capsule__brand-mark");
    expect(css).toContain("top-island-bubble__brand-mark");
  });

  it("keeps the top island brand mark readable inside the capsule", () => {
    const capsuleBrandCss = cssBlocksContaining(".top-island-capsule__brand-mark");
    const brandMarkCss = cssBlocksContaining(".top-island-capsule__brand-mark .conflux-brand-mark");

    expect(capsuleBrandCss).toMatch(/width:\s*26px/);
    expect(capsuleBrandCss).toMatch(/height:\s*26px/);
    expect(brandMarkCss).toMatch(/width:\s*20px/);
    expect(brandMarkCss).toMatch(/height:\s*20px/);
  });

  it("keeps the sidebar title brand mark large and unboxed", () => {
    const logoMarkCss = cssBlocksContaining(".sidebar-panel__logo-mark");
    const brandMarkCss = cssBlocksContaining(".sidebar-panel__logo-mark .conflux-brand-mark");

    expect(logoMarkCss).toMatch(/width:\s*32px/);
    expect(logoMarkCss).toMatch(/height:\s*32px/);
    expect(logoMarkCss).toMatch(/background:\s*transparent/);
    expect(logoMarkCss).toMatch(/border:\s*0/);
    expect(brandMarkCss).toMatch(/width:\s*28px/);
    expect(brandMarkCss).toMatch(/height:\s*28px/);
  });

  it("keeps all top island popover blocks on the 232px attached-detail contract", () => {
    const popoverCss = cssBlocksContaining(".top-island-popover.top-island-bubble");

    expect(popoverCss).toContain("var(--top-island-popover-width, 232px)");
    expect(popoverCss).not.toMatch(/width:\s*248px/);
    expect(popoverCss).not.toMatch(/radial-gradient/);
    expect(popoverCss).not.toMatch(/0\s+0\s+\d+px\s+rgba\(184,\s*212,\s*227/);
  });

  it("keeps all sidebar panel blocks from reverting to the old floating 360px drawer", () => {
    const sidebarCss = cssBlocksContaining(".sidebar-panel");

    expect(sidebarCss).toContain("var(--sidebar-rail-width, 300px)");
    expect(sidebarCss).not.toMatch(/min\(360px/);
    expect(sidebarCss).not.toMatch(/radial-gradient\(circle at top right/);
    expect(sidebarCss).not.toMatch(/0\s+0\s+\d+px\s+rgba\(184,\s*212,\s*227/);
  });

  it("keeps the sidebar attention band on the frozen 220px contract", () => {
    const bandCss = cssBlocksContaining(".sidebar-panel__band");

    expect(bandCss).toContain("width: var(--sidebar-band-width, 220px)");
  });

  it("keeps the expanded sidebar rail as a design gutter plus 220px chat band", () => {
    const spineCss = cssBlocksContaining(".sidebar-panel__spine");
    const bandCss = cssBlocksContaining(".sidebar-panel__band");
    const bodyCss = cssBlocksContaining(".sidebar-panel__body--stack");
    const footerCss = cssBlocksContaining(".sidebar-panel__footer");

    expect(spineCss).toContain("var(--sidebar-band-gutter, 38px)");
    expect(bandCss).toMatch(/flex:\s*0\s+0\s+var\(--sidebar-band-width,\s*220px\)/);
    expect(bandCss).not.toMatch(/margin-left:\s*auto/);
    expect(bodyCss).toMatch(/scrollbar-width:\s*none/);
    expect(cssBlocksContaining(".sidebar-panel__section--agents")).not.toMatch(/min-height:\s*178px/);
    expect(cssBlocksContaining(".sidebar-panel__section--notifications")).not.toMatch(/min-height:\s*158px/);
    expect(footerCss).not.toMatch(/margin-top:\s*auto/);
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

  it("keeps the final sidebar panel as a 300px rail without drawer glow", () => {
    const panelBlocks = cssBlocksFor(".sidebar-panel");
    const finalPanelBlock = findLastBlock(panelBlocks, (block) =>
      block.includes("--sidebar-rail-width")
    );

    expect(finalPanelBlock).toMatch(/width:\s*var\(--sidebar-rail-width,\s*300px\)/);
    expect(finalPanelBlock).toMatch(/flex-direction:\s*row/);
    expect(finalPanelBlock).not.toMatch(/min\(360px/);
    expect(finalPanelBlock).not.toMatch(/radial-gradient/);
    expect(finalPanelBlock).not.toMatch(/rgba\(184,\s*212,\s*227/);
    expect(finalPanelBlock).not.toMatch(/0\s+0\s+\d+px/);
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
});

