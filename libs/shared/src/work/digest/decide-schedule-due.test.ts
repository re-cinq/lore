import { describe, it, expect } from "vitest";
import { decideScheduleDue } from "./decide-due.js";

const mondayBerlin = {
  enabled: true,
  days: [1],
  time: "09:00",
  timezone: "Europe/Berlin",
};
const monday0905Berlin = new Date("2026-11-23T08:05:00Z");

describe("decideScheduleDue", () => {
  it("returns true at 09:05 Berlin on a Monday for Monday 09:00 with no earlier run", () => {
    expect(decideScheduleDue(mondayBerlin, monday0905Berlin, null)).toBe(true);
  });

  it("returns false when the schedule is disabled", () => {
    expect(
      decideScheduleDue(
        { ...mondayBerlin, enabled: false },
        monday0905Berlin,
        null,
      ),
    ).toBe(false);
  });

  it("returns false at 08:55 Berlin, before the scheduled time", () => {
    expect(
      decideScheduleDue(mondayBerlin, new Date("2026-11-23T07:55:00Z"), null),
    ).toBe(false);
  });

  it("returns false on a Tuesday for Monday only", () => {
    expect(
      decideScheduleDue(mondayBerlin, new Date("2026-11-24T08:05:00Z"), null),
    ).toBe(false);
  });

  it("returns false when the last run was earlier the same local day", () => {
    expect(
      decideScheduleDue(
        mondayBerlin,
        monday0905Berlin,
        new Date("2026-11-23T08:00:00Z"),
      ),
    ).toBe(false);
  });

  it("returns true when the last run was the previous local day", () => {
    expect(
      decideScheduleDue(
        mondayBerlin,
        monday0905Berlin,
        new Date("2026-11-22T08:00:00Z"),
      ),
    ).toBe(true);
  });
});
