import { describe, expect, it } from "vitest";
import { specPathOfPlan, specPathsOfPlan } from "./spec-plan-path.js";

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

  it("names specs/arm-image-builds/spec.md for a plan that creates the folder specs/arm-image-builds/", () => {
    const plan = { creates: [{ path: "specs/arm-image-builds/" }] };

    expect(specPathOfPlan(JSON.stringify(plan))).toBe(
      "specs/arm-image-builds/spec.md",
    );
  });

  it("is undefined for a spec plan that is not JSON", () => {
    expect(specPathOfPlan("{oops")).toBeUndefined();
  });

  it("is undefined for a spec plan with neither creates nor updates", () => {
    expect(specPathOfPlan("{}")).toBeUndefined();
  });
});

describe("specPathsOfPlan", () => {
  it("lists every spec path the plan creates, then every one it updates, skipping entries with no path", () => {
    const plan = {
      creates: [{ path: "specs/checkout/spec.md" }, { title: "no path" }],
      updates: [{ path: "specs/cart/spec.md" }],
    };

    expect(specPathsOfPlan(JSON.stringify(plan))).toEqual([
      "specs/checkout/spec.md",
      "specs/cart/spec.md",
    ]);
  });

  it("names the spec.md of every folder a plan creates or updates, and leaves a file path as it is", () => {
    const plan = {
      creates: [{ path: "specs/arm-image-builds/" }],
      updates: [{ path: "specs/cart" }, { path: "specs/checkout/spec.md" }],
    };

    expect(specPathsOfPlan(JSON.stringify(plan))).toEqual([
      "specs/arm-image-builds/spec.md",
      "specs/cart/spec.md",
      "specs/checkout/spec.md",
    ]);
  });

  it("is empty for a spec plan that is not JSON", () => {
    expect(specPathsOfPlan("{oops")).toEqual([]);
  });
});
