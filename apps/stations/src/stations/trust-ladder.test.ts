import { describe, expect, it } from "vitest";
import { nextTrust } from "./trust-ladder.js";

describe("nextTrust", () => {
  it("banks a merge without promoting below the threshold", () => {
    expect(nextTrust({ level: "docs", successful_tasks: 0 })).toEqual({
      hold: false,
      level: "docs",
      successfulTasks: 1,
      promoted: false,
    });
  });

  it("promotes and resets the counter on reaching the default threshold of 3", () => {
    expect(nextTrust({ level: "docs", successful_tasks: 2 })).toEqual({
      hold: false,
      level: "tests",
      successfulTasks: 0,
      promoted: true,
    });
  });

  it("honours a custom auto_promote_threshold", () => {
    expect(
      nextTrust({
        level: "tests",
        successful_tasks: 0,
        auto_promote_threshold: 1,
      }),
    ).toEqual({
      hold: false,
      level: "implementation",
      successfulTasks: 0,
      promoted: true,
    });
  });

  it("holds at full, where there is nothing left to climb", () => {
    expect(nextTrust({ level: "full", successful_tasks: 9 })).toEqual({
      hold: true,
      level: "full",
      successfulTasks: 9,
      promoted: false,
    });
  });

  it("holds when no level is recorded rather than inventing one", () => {
    expect(nextTrust(undefined)).toEqual({
      hold: true,
      level: undefined,
      successfulTasks: 0,
      promoted: false,
    });
  });

  it("climbs the whole ladder docs → tests → implementation → full", () => {
    const climb: string[] = [];
    let level = "docs";

    for (let i = 0; i < 3; i++) {
      const decision = nextTrust({ level, successful_tasks: 2 });

      level = decision.level as string;
      climb.push(level);
    }

    expect(climb).toEqual(["tests", "implementation", "full"]);
  });
});
