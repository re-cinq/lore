import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

const css = readFileSync(
  fileURLToPath(new URL("./globals.css", import.meta.url)),
  "utf8",
);

describe("globals.css form-control base styling", () => {
  it("groups button, input, select, and textarea into one shared base rule", () => {
    expect(css).toMatch(/button,\s*input,\s*select,\s*textarea\s*\{/);
  });

  it("opts every form control into the theme font, not the UA default", () => {
    const rule =
      css.match(/button,\s*input,\s*select,\s*textarea\s*\{([^}]*)\}/)?.[1] ??
      "";

    expect(rule).toContain("font-family: inherit");
  });

  it("pins native select option popups to theme surface tokens", () => {
    const rule = css.match(/option\s*\{([^}]*)\}/)?.[1] ?? "";

    expect(rule).toContain("var(--bg-surface)");
    expect(rule).toContain("var(--text)");
  });
});
