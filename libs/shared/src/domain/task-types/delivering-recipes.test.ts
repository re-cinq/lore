import { describe, it, expect } from "vitest";
import { isDeliveringRecipe } from "./delivering-recipes.js";

describe("isDeliveringRecipe", () => {
  it("counts spec-write as delivering, since the push node after it is another pod with a fresh clone", () => {
    expect(isDeliveringRecipe("spec-write")).toBe(true);
  });

  it("does not count spec-analysis, whose deliverable is an artifact rather than the branch", () => {
    expect(isDeliveringRecipe("spec-analysis")).toBe(false);
  });

  it("counts gap-fill and general as delivering, since validate and push after them are other pods (15 of 36 gap-fill branches shipped 0 commits between 2026-08-15 and 2026-09-25)", () => {
    expect(isDeliveringRecipe("gap-fill")).toBe(true);
    expect(isDeliveringRecipe("general")).toBe(true);
  });
});
