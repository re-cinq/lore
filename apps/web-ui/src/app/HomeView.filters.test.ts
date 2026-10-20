import { describe, it, expect } from "vitest";
import { parseRepoFilter, repoAttention } from "./HomeView.filters";

describe("parseRepoFilter", () => {
  it("reads a known filter and falls back to all for anything else", () => {
    expect(parseRepoFilter("attention")).toBe("attention");
    expect(parseRepoFilter(["running", "all"])).toBe("running");
    expect(parseRepoFilter("bogus")).toBe("all");
  });
});

describe("repoAttention", () => {
  it("ranks a missing ingest workflow above an outdated spec-impact one", () => {
    const both = new Set(["a/b"]);

    expect(repoAttention("a/b", new Map([["a/b", "missing"]]), both)).toEqual({
      label: "No ingest workflow",
      tone: "danger",
    });
    expect(repoAttention("a/b", new Map(), new Set())).toBeNull();
  });
});
