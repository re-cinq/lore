import { describe, expect, it } from "vitest";
import { planUrlOf } from "./plan-url.js";

describe("planUrlOf", () => {
  it("returns the plan page under the web UI with the trailing slash dropped", () => {
    expect(planUrlOf("https://lore.example/", "re-cinq/lore", "p1")).toBe(
      "https://lore.example/repos/re-cinq/lore/plans/p1",
    );
  });

  it("returns undefined when the deployment names no web UI", () => {
    expect(planUrlOf(undefined, "re-cinq/lore", "p1")).toBeUndefined();
  });
});
