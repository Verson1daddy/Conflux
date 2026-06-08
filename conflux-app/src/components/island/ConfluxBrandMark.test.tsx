import { createElement } from "react";
import TestRenderer from "react-test-renderer";
import { describe, expect, it } from "vitest";
import { ConfluxBrandMark } from "./ConfluxBrandMark";

describe("ConfluxBrandMark", () => {
  it("renders the light artwork as a decorative mark by default", () => {
    const renderer = TestRenderer.create(createElement(ConfluxBrandMark));
    const image = renderer.root.findByType("img");

    expect(image.props.className).toBe("conflux-brand-mark");
    expect(image.props["aria-hidden"]).toBe("true");
    expect(image.props.alt).toBe("");
    expect(image.props["data-artwork"]).toBe("light");
  });

  it("can render an accessible brand label", () => {
    const renderer = TestRenderer.create(
      createElement(ConfluxBrandMark, {
        decorative: false,
        label: "Conflux",
        artwork: "dark",
      })
    );
    const image = renderer.root.findByType("img");

    expect(image.props.className).toBe("conflux-brand-mark");
    expect(image.props.alt).toBe("Conflux");
    expect(image.props["data-artwork"]).toBe("dark");
    expect(image.props["aria-hidden"]).toBeUndefined();
  });

  it("uses transparent SVG artwork without embedded background rectangles", async () => {
    const [{ default: lightSvg }, { default: darkSvg }] = await Promise.all([
      import("@/assets/brand/icon-light.svg?raw"),
      import("@/assets/brand/icon-dark.svg?raw"),
    ]);

    expect(lightSvg).not.toMatch(/<rect\b/);
    expect(darkSvg).not.toMatch(/<rect\b/);
  });
});
