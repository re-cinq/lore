import { describe, expect, it } from "vitest";
import { mergeCandidate } from "./merge-candidate.js";

const REPO = "re-cinq/lore";

describe("mergeCandidate", () => {
  it("takes an open pull request ready for review on a branch of re-cinq/lore", () => {
    expect(
      mergeCandidate({ state: "open", headRepo: "Re-Cinq/Lore" }, REPO),
    ).toBe(true);
  });

  it("leaves a draft, a closed pull request and a fork's branch", () => {
    expect([
      mergeCandidate({ state: "open", draft: true }, REPO),
      mergeCandidate({ state: "closed" }, REPO),
      mergeCandidate({ state: "open", headRepo: "someone/lore" }, REPO),
    ]).toEqual([false, false, false]);
  });
});
