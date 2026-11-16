import { describe, it, expect } from "vitest";
import { isPlanPage } from "./repo-chrome";

const base = "/repos/re-cinq/lore";

describe("isPlanPage", () => {
  it("reads /repos/re-cinq/lore/plans/p1 as a plan page", () => {
    expect(isPlanPage(`${base}/plans/p1`, base)).toBe(true);
  });

  it("reads a path below a plan as a plan page", () => {
    expect(isPlanPage(`${base}/plans/p1/edit`, base)).toBe(true);
  });

  it("reads /repos/re-cinq/lore/plans as not a plan page", () => {
    expect(isPlanPage(`${base}/plans`, base)).toBe(false);
  });

  it("reads /repos/re-cinq/lore/plans/new as not a plan page", () => {
    expect(isPlanPage(`${base}/plans/new`, base)).toBe(false);
  });

  it("reads another repo's plan as not a plan page", () => {
    expect(isPlanPage("/repos/re-cinq/other/plans/p1", base)).toBe(false);
  });
});
