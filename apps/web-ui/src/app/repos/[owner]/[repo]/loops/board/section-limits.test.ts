import { describe, expect, it } from "vitest";
import { loadMoreHref, sectionLimitsOf, shownRows } from "./section-limits";

describe("sectionLimitsOf", () => {
  it("shows 5 rows of every section but Current by default, and 10 recent rows for ?recent=10", () => {
    expect([sectionLimitsOf({}), sectionLimitsOf({ recent: "10" })]).toEqual([
      { backlog: 5, parked: 5, awaiting_merge: 5, recent: 5 },
      { backlog: 5, parked: 5, awaiting_merge: 5, recent: 10 },
    ]);
  });

  it("falls back to 5 for ?recent=abc, ?recent=0 and ?recent=5000", () => {
    expect(
      ["abc", "0", "5000"].map((recent) => sectionLimitsOf({ recent }).recent),
    ).toEqual([5, 5, 5]);
  });
});

describe("shownRows", () => {
  it("shows all 9 current rows, and 5 of 6 recent rows with more to load", () => {
    const limits = sectionLimitsOf({});
    const nine = Array.from({ length: 9 }, (_, at) => at);

    expect([
      shownRows("current", nine, limits),
      shownRows("recent", nine.slice(0, 6), limits),
      shownRows("recent", nine.slice(0, 5), limits),
    ]).toEqual([
      { rows: nine, hasMore: false },
      { rows: [0, 1, 2, 3, 4], hasMore: true },
      { rows: [0, 1, 2, 3, 4], hasMore: false },
    ]);
  });
});

describe("loadMoreHref", () => {
  it("keeps ?loop=review and the parked count, and asks for 5 more recent rows", () => {
    expect(
      loadMoreHref(
        "/repos/re-cinq/lore/loops",
        { loop: "review", parked: "10" },
        "recent",
      ),
    ).toBe("/repos/re-cinq/lore/loops?loop=review&parked=10&recent=10");
  });
});
