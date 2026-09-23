import { describe, it, expect } from "vitest";
import { isDeliveringRecipe } from "./delivering-recipes.js";

describe("isDeliveringRecipe", () => {
  it("counts spec-write as delivering, since the push node after it is another pod with a fresh clone", () => {
    expect(isDeliveringRecipe("spec-write")).toBe(true);
  });

  it("does not count spec-analysis, whose deliverable is an artifact rather than the branch", () => {
    expect(isDeliveringRecipe("spec-analysis")).toBe(false);
  });
});
