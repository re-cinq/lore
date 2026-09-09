import { describe, it, expect } from "vitest";
import {
  resolveCredentialField,
  decorationRange,
  entriesForPath,
  partitionByLayer,
} from "./decoration-math.js";
import type { RangeEntry } from "./spec-index.js";

function entry(overrides: Partial<RangeEntry>): RangeEntry {
  return {
    startLine: 1,
    endLine: 1,
    layer: "implemented",
    evidence: "human-linked",
    statementText: "text",
    specPath: "spec.md",
    specLine: 1,
    related: [],
    ...overrides,
  };
}

describe("resolveCredentialField", () => {
  it("returns the trimmed raw value when present", () => {
    expect(resolveCredentialField(" https://api.example ", null)).toBe(
      "https://api.example",
    );
  });

  it("falls back when raw is undefined", () => {
    expect(resolveCredentialField(undefined, "fallback")).toBe("fallback");
  });

  it("falls back when raw is empty or whitespace-only", () => {
    expect(resolveCredentialField("   ", "fallback")).toBe("fallback");
  });

  it("returns null when raw is absent and fallback is null", () => {
    expect(resolveCredentialField(undefined, null)).toBeNull();
  });
});

describe("decorationRange", () => {
  it("converts 1-based start/end lines to a 0-based clamped range", () => {
    expect(decorationRange(entry({ startLine: 5, endLine: 8 }), 100)).toEqual({
      start: 4,
      end: 7,
    });
  });

  it("clamps the start line to 0 when startLine is 0 or negative", () => {
    expect(decorationRange(entry({ startLine: 0, endLine: 2 }), 100)).toEqual({
      start: 0,
      end: 1,
    });
  });

  it("clamps end to the document's last line", () => {
    expect(decorationRange(entry({ startLine: 5, endLine: 500 }), 10)).toEqual({
      start: 4,
      end: 10,
    });
  });

  it("clamps end to at least the clamped start", () => {
    expect(decorationRange(entry({ startLine: 5, endLine: 1 }), 100)).toEqual({
      start: 4,
      end: 4,
    });
  });
});

describe("entriesForPath", () => {
  it("returns an empty array for a null path", () => {
    expect(entriesForPath(new Map(), null)).toEqual([]);
  });

  it("returns an empty array for a path missing from the index", () => {
    expect(entriesForPath(new Map(), "src/a.ts")).toEqual([]);
  });

  it("returns the entries stored for a present path", () => {
    const entries = [entry({})];
    const index = new Map([["src/a.ts", entries]]);

    expect(entriesForPath(index, "src/a.ts")).toBe(entries);
  });
});

describe("partitionByLayer", () => {
  it("splits entries into implemented and covered by layer", () => {
    const implementedEntry = entry({ layer: "implemented" });
    const coveredEntry = entry({ layer: "covered" });

    expect(partitionByLayer([implementedEntry, coveredEntry])).toEqual({
      implemented: [implementedEntry],
      covered: [coveredEntry],
    });
  });

  it("returns empty arrays for no entries", () => {
    expect(partitionByLayer([])).toEqual({ implemented: [], covered: [] });
  });
});
