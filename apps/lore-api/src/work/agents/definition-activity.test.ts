import { describe, it, expect } from "vitest";
import { activityByDefinition } from "./definition-activity.js";

const row = (key: string | null, visits: number, costUsd: number) => ({
  key,
  costUsd,
  tokensIn: visits * 100,
  tokensOut: visits * 10,
  visits,
  visitsMissingCost: 0,
  unpriced: [],
});

describe("activityByDefinition", () => {
  it("returns loop-fix-ci with 5 visits and $1.50 when its two stations report 2 and 3 visits", () => {
    const definitions = new Map([
      ["loop-fix-ci", "loop-fix-ci"],
      ["loop-fix-ci-final", "loop-fix-ci"],
      ["loop-dod", "loop-dod"],
    ]);

    expect(
      activityByDefinition(
        [
          row("loop-fix-ci", 2, 0.5),
          row("loop-fix-ci-final", 3, 1),
          row("loop-dod", 1, 0.25),
        ],
        definitions,
      ),
    ).toEqual([
      {
        name: "loop-dod",
        visits: 1,
        costUsd: 0.25,
        tokensIn: 100,
        tokensOut: 10,
      },
      {
        name: "loop-fix-ci",
        visits: 5,
        costUsd: 1.5,
        tokensIn: 500,
        tokensOut: 50,
      },
    ]);
  });

  it("returns nothing for open-pr and an unkeyed row, which no definition runs", () => {
    expect(
      activityByDefinition([row("open-pr", 4, 0), row(null, 1, 0)], new Map()),
    ).toEqual([]);
  });
});
