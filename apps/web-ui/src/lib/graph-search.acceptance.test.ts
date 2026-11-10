import { describe, it, expect } from "vitest";
import { nodeMatchesQuery } from "./graph-search";

describe("FR — graph-search", () => {
  it("returns false when neither field contains the query, even if their concatenation does", () => {
    expect(
      nodeMatchesQuery({ label: "alpha", path: "beta" }, "alpha beta"),
    ).toBe(false);
  });
});
