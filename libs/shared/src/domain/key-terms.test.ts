import { describe, it, expect } from "vitest";
import { extractKeyTerms, keyTermsQuery } from "./key-terms.js";

describe("extractKeyTerms", () => {
  it("keeps distinctive terms and drops stopwords + short words", () => {
    const terms = extractKeyTerms(
      "add the UI controls for per-repo settings and parseSettingsForm",
    );

    expect(terms).toEqual([
      "controls",
      "per-repo",
      "settings",
      "parseSettingsForm",
    ]);
  });

  it("de-duplicates and caps the number of terms", () => {
    expect({
      deduped: extractKeyTerms("settings settings settings", 12),
      capped: extractKeyTerms(
        Array.from({ length: 40 }, (_, i) => `term${i}`).join(" "),
        12,
      ).length,
    }).toEqual({ deduped: ["settings"], capped: 12 });
  });
});

describe("keyTermsQuery", () => {
  it("OR-joins 'split the port for lore-api' into 'split OR port OR lore-api'", () => {
    expect(keyTermsQuery("split the port for lore-api")).toBe(
      "split OR port OR lore-api",
    );
  });

  it("falls back to the raw query 'to be' when no term survives", () => {
    expect(keyTermsQuery("to be")).toBe("to be");
  });
});
