import { describe, it, expect } from "vitest";
import { extractBearer, secretEquals } from "./bearer.js";

describe("extractBearer", () => {
  it("returns the credential after the Bearer scheme", () => {
    expect(extractBearer("Bearer lca_abc123")).toBe("lca_abc123");
  });

  it("matches the scheme case-insensitively per RFC 7235", () => {
    expect(extractBearer("bearer tok")).toBe("tok");
    expect(extractBearer("BEARER tok")).toBe("tok");
  });

  it("takes the first value of a multi-value header", () => {
    expect(extractBearer(["Bearer first", "Bearer second"])).toBe("first");
  });

  it("returns undefined when Bearer is not the prefix", () => {
    expect(extractBearer("Basic Zm9v")).toBeUndefined();
    expect(extractBearer("x Bearer tok")).toBeUndefined();
    expect(extractBearer("Bearer")).toBeUndefined();
    expect(extractBearer(undefined)).toBeUndefined();
    expect(extractBearer(42)).toBeUndefined();
  });
});

describe("secretEquals", () => {
  it("returns true only on an exact match", () => {
    expect(secretEquals("lca_abc", "lca_abc")).toBe(true);
    expect(secretEquals("lca_abc", "lca_abd")).toBe(false);
    expect(secretEquals("lca_abc", "lca_ab")).toBe(false);
    expect(secretEquals("", "")).toBe(true);
  });
});
