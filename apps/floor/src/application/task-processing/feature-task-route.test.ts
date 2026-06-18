import { describe, it, expect } from "vitest";
import { featureTaskRoute } from "./feature-task-route.js";

describe("featureTaskRoute", () => {
  it("routes feature-decompose in-process on every backend", () => {
    for (const backend of ["docker", "k8s", "inprocess"] as const) {
      expect(featureTaskRoute("feature-decompose", backend)).toBe("decompose");
    }
  });

  it("routes feature-finalize in-process on every backend (deterministic commit + PR, no pod)", () => {
    for (const backend of ["docker", "k8s", "inprocess"] as const) {
      expect(featureTaskRoute("feature-finalize", backend)).toBe("finalize");
    }
  });

  it("routes feature-planning in-process only under the inprocess escape hatch", () => {
    expect(featureTaskRoute("feature-planning", "inprocess")).toBe("planning");
    expect(featureTaskRoute("feature-planning", "docker")).toBeNull();
    expect(featureTaskRoute("feature-planning", "k8s")).toBeNull();
  });

  it("returns null for non-feature task types (they take the normal/Station ladder)", () => {
    expect(featureTaskRoute("implementation", "docker")).toBeNull();
    expect(featureTaskRoute("general", "inprocess")).toBeNull();
  });
});
