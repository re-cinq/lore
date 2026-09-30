import { describe, expect, it } from "vitest";
import { specPathOfPlan } from "./spec-plan-path.js";

describe("specPathOfPlan", () => {
  it("names specs/checkout/spec.md, the first path a spec plan creates", () => {
    const plan = {
      creates: [{ path: "specs/checkout/spec.md" }],
      updates: [{ path: "specs/cart/spec.md" }],
    };

    expect(specPathOfPlan(JSON.stringify(plan))).toBe("specs/checkout/spec.md");
  });

  it("names specs/cart/spec.md, the first path a spec plan updates, when it creates none", () => {
    const plan = { creates: [], updates: [{ path: "specs/cart/spec.md" }] };

    expect(specPathOfPlan(JSON.stringify(plan))).toBe("specs/cart/spec.md");
  });

  it("is undefined for a spec plan that is not JSON", () => {
    expect(specPathOfPlan("{oops")).toBeUndefined();
  });

  it("is undefined for a spec plan with neither creates nor updates", () => {
    expect(specPathOfPlan("{}")).toBeUndefined();
  });
});
