import { enforceTrue } from "@re-cinq/lore-shared/lib/enforce.js";
// @vitest-environment jsdom
import { describe, it, expect, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import type { ThemeFamily } from "@/lib/theme/types";

// Drive the `family` branch directly: the real ThemeProvider seeds family from
// the DOM/inline-script, which is irrelevant here. We only care that Icon maps
// `ICONS[family][name]` correctly and threads size/className/aria through.
const family = vi.fn<() => ThemeFamily>(() => "elegant");
vi.mock("@/lib/theme/ThemeProvider", () => ({
  useTheme: () => ({ family: family() }),
}));

import Icon from "./Icon";
import { ICONS, type IconName } from "./icon-map";

const ALL_NAMES = Object.keys(ICONS.elegant) as IconName[];

function svgOf(name: IconName, fam: ThemeFamily = "elegant") {
  family.mockReturnValue(fam);
  const { container } = render(<Icon name={name} />);
  const svg = container.querySelector("svg");
  enforceTrue(svg, new Error(`no svg rendered for ${fam}/${name}`));
  return svg;
}

describe("Icon icon-family mapping", () => {
  it.each(ALL_NAMES)(
    "renders the lucide glyph for the elegant family: %s",
    (name) => {
      const expected = ICONS.elegant[name];
      expect(expected.startsWith("lucide:")).toBe(true);
      // Every elegant glyph resolves to an inline lucide <svg> (no <span> fallback).
      expect(svgOf(name, "elegant").getAttribute("class")).toContain(
        "iconify--lucide",
      );
    },
  );

  it.each(ALL_NAMES)(
    "renders the pixelarticons glyph for the retro family: %s",
    (name) => {
      const expected = ICONS.retro[name];
      expect(expected.startsWith("pixelarticons:")).toBe(true);
      expect(svgOf(name, "retro").getAttribute("class")).toContain(
        "iconify--pixelarticons",
      );
    },
  );

  it("swaps the rendered collection when the family changes for the same name", () => {
    expect(svgOf("check", "elegant").getAttribute("class")).toContain(
      "iconify--lucide",
    );
    expect(svgOf("check", "retro").getAttribute("class")).toContain(
      "iconify--pixelarticons",
    );
  });
});

describe("Icon size prop", () => {
  it("defaults width and height to 16 when size is omitted", () => {
    const svg = svgOf("check", "elegant");
    expect(svg.getAttribute("width")).toBe("16");
    expect(svg.getAttribute("height")).toBe("16");
  });

  it("uses the provided size for both width and height", () => {
    family.mockReturnValue("elegant");
    const { container } = render(<Icon name="search" size={32} />);
    const svg = container.querySelector("svg")!;
    expect(svg.getAttribute("width")).toBe("32");
    expect(svg.getAttribute("height")).toBe("32");
  });
});

describe("Icon className prop", () => {
  it("appends a custom className alongside the iconify base classes", () => {
    family.mockReturnValue("retro");
    const { container } = render(<Icon name="settings" className="nav-icon" />);
    const cls = container.querySelector("svg")!.getAttribute("class") ?? "";
    expect(cls).toContain("iconify");
    expect(cls).toContain("nav-icon");
  });

  it("renders without a custom class token when className is omitted", () => {
    family.mockReturnValue("elegant");
    const { container } = render(<Icon name="menu" />);
    const cls = container.querySelector("svg")!.getAttribute("class") ?? "";
    expect(cls).toContain("iconify");
    expect(cls.split(/\s+/)).not.toContain("nav-icon");
  });
});

describe("Icon aria handling", () => {
  it("exposes the label and is not aria-hidden-only when aria-label is given", () => {
    family.mockReturnValue("elegant");
    render(<Icon name="close" aria-label="Close menu" />);
    const labelled = screen.getByLabelText("Close menu");
    expect(labelled.tagName.toLowerCase()).toBe("svg");
    // Branch: aria present -> the component passes aria-hidden={undefined}.
    expect(labelled).toHaveAttribute("aria-label", "Close menu");
  });

  it("marks the glyph aria-hidden and exposes no label when aria-label is omitted", () => {
    const svg = svgOf("lock", "elegant");
    expect(svg).toHaveAttribute("aria-hidden", "true");
    expect(svg).not.toHaveAttribute("aria-label");
    expect(screen.queryByLabelText("lock")).toBeNull();
  });
});
