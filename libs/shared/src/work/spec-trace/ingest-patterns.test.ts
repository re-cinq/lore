import { describe, it, expect } from "vitest";
import { parseIngestPatterns, matchesAnyGlob } from "./ingest-patterns.js";

describe("parseIngestPatterns", () => {
  it("keeps per-kind glob string arrays and drops non-array / non-string entries", () => {
    expect(
      parseIngestPatterns({
        specs: ["specs/**/*.md", ".specify/**/*.md"],
        adrs: ["adrs/*.md"],
        broken: "not-an-array",
        mixed: [1, "keep-me", null],
      }),
    ).toEqual({
      specs: ["specs/**/*.md", ".specify/**/*.md"],
      adrs: ["adrs/*.md"],
      mixed: ["keep-me"],
    });
  });

  it("returns an empty map for non-object input", () => {
    expect(parseIngestPatterns(undefined)).toEqual({});
    expect(parseIngestPatterns("nope")).toEqual({});
    expect(parseIngestPatterns(["a"])).toEqual({});
  });
});

describe("matchesAnyGlob", () => {
  it("matches a path against ** globs and rejects non-matches", () => {
    expect(matchesAnyGlob("specs/auth/spec.md", ["specs/**/*.md"])).toBe(true);
    expect(
      matchesAnyGlob(".specify/spec.md", ["specs/**/*.md", ".specify/**/*.md"]),
    ).toBe(true);
    expect(matchesAnyGlob("docs/readme.md", ["specs/**/*.md"])).toBe(false);
  });
});
