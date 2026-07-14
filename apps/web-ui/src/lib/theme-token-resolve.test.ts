import { describe, it, expect } from "vitest";
import { cssToken, resolveColor } from "./theme-token-resolve";

const lookup = (values: Record<string, string>) => (name: string) =>
  values[name] ?? "";

describe("cssToken", () => {
  it("returns the trimmed token value from the lookup", () => {
    expect(cssToken(lookup({ "--success": " #16a34a " }), "--success", "#000")).toBe(
      "#16a34a",
    );
  });

  it("falls back when the lookup yields empty or whitespace", () => {
    expect(cssToken(lookup({}), "--success", "#16a34a")).toBe("#16a34a");
    expect(cssToken(lookup({ "--success": "   " }), "--success", "#16a34a")).toBe(
      "#16a34a",
    );
  });
});

describe("resolveColor", () => {
  it("resolves a var() reference to the literal the theme defines", () => {
    expect(
      resolveColor(lookup({ "--chart-feature": "#db2777" }), "var(--chart-feature)"),
    ).toBe("#db2777");
  });

  it("passes literal colors through untouched", () => {
    expect(resolveColor(lookup({}), "#ff8000")).toBe("#ff8000");
  });

  it("falls back to neutral when the referenced token is undefined", () => {
    expect(resolveColor(lookup({}), "var(--chart-nope)")).toBe("#94a3b8");
  });

  it("uses a caller-supplied fallback over the neutral default", () => {
    expect(resolveColor(lookup({}), "var(--chart-nope)", "#ffffff")).toBe(
      "#ffffff",
    );
  });
});
