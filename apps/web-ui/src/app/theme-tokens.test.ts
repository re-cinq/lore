import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

const css = readFileSync(
  fileURLToPath(new URL("./theme.css", import.meta.url)),
  "utf-8",
).replace(/"/g, "'");

function declarationsOf(selector: string): Record<string, string> {
  const start = css.indexOf(selector);

  expect(start).toBeGreaterThanOrEqual(0);
  const body = css.slice(css.indexOf("{", start) + 1, css.indexOf("}", start));

  return Object.fromEntries(
    [...body.matchAll(/(--[a-z0-9-]+)\s*:\s*([^;]+);/g)].map((m) => [
      m[1],
      m[2].trim(),
    ]),
  );
}

function tokensOf(selector: string): Set<string> {
  return new Set(Object.keys(declarationsOf(selector)));
}

const RETRO = "[data-theme-family='retro'] {";
const RETRO_LIGHT = "[data-theme-family='retro'][data-color-scheme='light']";
const RETRO_DARK = "[data-theme-family='retro'][data-color-scheme='dark']";
const CHICAGO = "[data-theme-family='chicago'] {";
const CHICAGO_LIGHT =
  "[data-theme-family='chicago'][data-color-scheme='light']";
const CHICAGO_DARK = "[data-theme-family='chicago'][data-color-scheme='dark']";

const OVERRIDE_BLOCKS = [
  "[data-color-scheme='dark'] {",
  RETRO,
  RETRO_LIGHT,
  RETRO_DARK,
  CHICAGO,
  CHICAGO_LIGHT,
  CHICAGO_DARK,
];

const DEFAULTS = ":root {";
const defaults = tokensOf(DEFAULTS);

const CHART_TOKENS = [
  "--chart-feature",
  "--chart-spec",
  "--chart-section",
  "--chart-statement",
  "--chart-criterion",
  "--chart-test",
  "--chart-code",
  "--chart-adr",
  "--chart-neutral",
];

describe("theme.css token contract", () => {
  it("overrides only tokens the :root defaults declare, in every theme and scheme block", () => {
    const undeclared = OVERRIDE_BLOCKS.flatMap((block) =>
      [...tokensOf(block)]
        .filter((token) => !defaults.has(token))
        .map((token) => `${block} ${token}`),
    );

    expect(undeclared).toEqual([]);
  });

  it("defines the same color token names in the light and dark blocks of each overriding family", () => {
    expect([...tokensOf(RETRO_DARK)].sort()).toEqual(
      [...tokensOf(RETRO_LIGHT)].sort(),
    );
    expect([...tokensOf(CHICAGO_DARK)].sort()).toEqual(
      [...tokensOf(CHICAGO_LIGHT)].sort(),
    );
  });

  it("defines the chart palette in the defaults and per scheme for retro and chicago", () => {
    for (const block of [
      DEFAULTS,
      RETRO_LIGHT,
      RETRO_DARK,
      CHICAGO_LIGHT,
      CHICAGO_DARK,
    ]) {
      expect([...tokensOf(block)]).toEqual(
        expect.arrayContaining(CHART_TOKENS),
      );
    }
  });

  it("pins every retro body size to the 14px bitmap grid", () => {
    expect(declarationsOf(RETRO)).toMatchObject({
      "--fs-2xs": "14px",
      "--fs-xs": "14px",
      "--fs-sm": "14px",
      "--fs-base": "14px",
    });
  });

  it("defines the sidebar micro-label size as 10px by default and 14px for retro", () => {
    expect(declarationsOf(DEFAULTS)["--fs-2xs"]).toBe("10px");
    expect(declarationsOf(RETRO)["--fs-2xs"]).toBe("14px");
  });

  it("declares the spacing, font-weight, line-height and z-index scales in the defaults", () => {
    expect(declarationsOf(DEFAULTS)).toMatchObject({
      "--space-1": "2px",
      "--space-2": "4px",
      "--space-3": "8px",
      "--space-4": "12px",
      "--space-5": "16px",
      "--space-6": "24px",
      "--space-7": "32px",
      "--space-8": "48px",
      "--fw-normal": "400",
      "--fw-medium": "500",
      "--fw-semibold": "600",
      "--fw-bold": "700",
      "--lh-1": "1",
      "--lh-sm": "1.25",
      "--lh-base": "1.5",
      "--lh-lg": "1.65",
      "--z-raised": "1",
      "--z-dropdown": "10",
      "--z-sticky": "20",
      "--z-backdrop": "40",
      "--z-offcanvas": "50",
      "--z-popover": "60",
    });
  });

  it("gives chicago a compact spacing scale and bold-only weights", () => {
    expect(declarationsOf(CHICAGO)).toMatchObject({
      "--space-3": "6px",
      "--space-4": "8px",
      "--space-5": "12px",
      "--fw-medium": "700",
      "--fw-semibold": "700",
    });
  });
});
