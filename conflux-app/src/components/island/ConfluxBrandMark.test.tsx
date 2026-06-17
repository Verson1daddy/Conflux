import { createElement } from "react";
import TestRenderer from "react-test-renderer";
import { describe, expect, it } from "vitest";
import { ConfluxBrandMark } from "./ConfluxBrandMark";

describe("ConfluxBrandMark", () => {
  it("renders an inline decorative svg mark by default", () => {
    const renderer = TestRenderer.create(createElement(ConfluxBrandMark));
    const svg = renderer.root.findByType("svg");

    expect(svg.props.className).toBe("conflux-brand-mark");
    expect(svg.props["aria-hidden"]).toBe("true");
    expect(svg.props.role).toBeUndefined();
    expect(svg.props["data-artwork"]).toBe("light");
  });

  it("can render an accessible brand label", () => {
    const renderer = TestRenderer.create(
      createElement(ConfluxBrandMark, {
        decorative: false,
        label: "Conflux",
        artwork: "dark",
      })
    );
    const svg = renderer.root.findByType("svg");

    expect(svg.props.className).toBe("conflux-brand-mark");
    expect(svg.props.role).toBe("img");
    expect(svg.props["aria-label"]).toBe("Conflux");
    expect(svg.props["data-artwork"]).toBe("dark");
    expect(svg.props["aria-hidden"]).toBeUndefined();
  });

  it("draws the glyph without a background rect and adapts via currentColor", () => {
    const renderer = TestRenderer.create(createElement(ConfluxBrandMark));

    // 无背景方块：只有花瓣本身。
    expect(renderer.root.findAllByType("rect")).toHaveLength(0);

    // 花瓣体走 currentColor → 自动跟随所在表面前景色取对比。
    const paths = renderer.root.findAllByType("path");
    expect(paths.length).toBeGreaterThan(0);
    expect(paths.some((p) => p.props.fill === "currentColor")).toBe(true);
  });
});
