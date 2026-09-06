import { describe, it, expect } from "vitest";
import { secretEquals } from "./secret-equals.js";

describe("secretEquals", () => {
  it("returns true only on an exact match", () => {
    expect(secretEquals("lca_abc", "lca_abc")).toBe(true);
    expect(secretEquals("lca_abc", "lca_abd")).toBe(false);
    expect(secretEquals("lca_abc", "lca_ab")).toBe(false);
    expect(secretEquals("", "")).toBe(true);
  });
});
