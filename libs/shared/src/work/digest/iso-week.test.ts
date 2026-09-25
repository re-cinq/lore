import { describe, it, expect } from "vitest";
import { isoWeekKey } from "./iso-week.js";

describe("isoWeekKey", () => {
  it("assigns Monday 2026-09-21 and Sunday 2026-09-27 the key 2026-W39", () => {
    expect(isoWeekKey(new Date("2026-09-21T10:00:00Z"), "Europe/Berlin")).toBe(
      "2026-W39",
    );
    expect(isoWeekKey(new Date("2026-09-27T10:00:00Z"), "Europe/Berlin")).toBe(
      "2026-W39",
    );
  });

  it("uses the local date when UTC is still the previous day, Sunday 23:30Z being Monday 08:30 in Tokyo", () => {
    expect(isoWeekKey(new Date("2026-09-27T23:30:00Z"), "Asia/Tokyo")).toBe(
      "2026-W40",
    );
  });

  it("returns W53 for a year that has one", () => {
    expect(isoWeekKey(new Date("2026-12-31T12:00:00Z"), "UTC")).toBe(
      "2026-W53",
    );
  });
});
