import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

const css = readFileSync(
  fileURLToPath(new URL("./theme.css", import.meta.url)),
  "utf-8",
);

function tokensOf(selector: string): Set<string> {
  const start = css.indexOf(selector);

  expect(start).toBeGreaterThanOrEqual(0);
  const body = css.slice(css.indexOf("{", start) + 1, css.indexOf("}", start));

  return new Set([...body.matchAll(/--[a-z0-9-]+(?=\s*:)/g)].map((m) => m[0]));
}

function declarationsOf(selector: string): Record<string, string> {
  const start = css.indexOf(selector);
  const body = css.slice(css.indexOf("{", start) + 1, css.indexOf("}", start));

  return Object.fromEntries(
    [...body.matchAll(/(--[a-z0-9-]+)\s*:\s*([^;]+);/g)].map((m) => [
      m[1],
      m[2].trim(),
    ]),
  );
}

const elegantFamily = tokensOf("[data-theme-family='elegant'] {");
const retroFamily = tokensOf("[data-theme-family='retro'] {");
const elegantLight = tokensOf(
  "[data-theme-family='elegant'][data-color-scheme='light']",
);
const elegantDark = tokensOf(
  "[data-theme-family='elegant'][data-color-scheme='dark']",
);
const retroLight = tokensOf(
  "[data-theme-family='retro'][data-color-scheme='light']",
);
const retroDark = tokensOf(
  "[data-theme-family='retro'][data-color-scheme='dark']",
);

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
  it("defines the same color token names in the light and dark blocks of each family", () => {
    expect([...elegantDark].sort()).toEqual([...elegantLight].sort());
    expect([...retroDark].sort()).toEqual([...retroLight].sort());
  });

  it("defines the chart palette once at the elegant family level and per scheme for retro", () => {
    for (const token of CHART_TOKENS) {
      expect(elegantFamily).toContain(token);
      expect(elegantLight).not.toContain(token);
      expect(elegantDark).not.toContain(token);
      expect(retroDark).toContain(token);
      expect(retroLight).toContain(token);
      expect(retroFamily).not.toContain(token);
    }
  });

  it("pins every retro body size to the 14px bitmap grid", () => {
    const retro = declarationsOf("[data-theme-family='retro'] {");

    expect(retro).toMatchObject({
      "--fs-2xs": "14px",
      "--fs-xs": "14px",
      "--fs-sm": "14px",
      "--fs-base": "14px",
    });
  });

  it("defines the sidebar micro-label size in both families", () => {
    expect(declarationsOf("[data-theme-family='elegant'] {")["--fs-2xs"]).toBe(
      "10px",
    );
    expect(declarationsOf("[data-theme-family='retro'] {")["--fs-2xs"]).toBe(
      "14px",
    );
  });
});
