import { describe, it, expect } from "vitest";
import { presetInterval, spendWindowQuery } from "./spend-window-presets";

const NOW = new Date("2026-09-02T12:00:00Z");

describe("presetInterval", () => {
  it("today is a single-day interval", () => {
    expect(presetInterval("today", NOW)).toEqual({
      from: "2026-09-02",
      to: "2026-09-02",
    });
  });

  it("7d and 30d end today and reach back", () => {
    expect(presetInterval("7d", NOW)).toEqual({
      from: "2026-08-26",
      to: "2026-09-02",
    });
    expect(presetInterval("30d", NOW)).toEqual({
      from: "2026-08-03",
      to: "2026-09-02",
    });
  });

  it("mtd starts on the first of the current month", () => {
    expect(presetInterval("mtd", NOW)).toEqual({
      from: "2026-09-01",
      to: "2026-09-02",
    });
  });
});

describe("spendWindowQuery", () => {
  it("renders the parameter names the API validates", () => {
    expect(spendWindowQuery({ from: "2026-09-01", to: "2026-09-02" })).toBe(
      "from=2026-09-01&to=2026-09-02",
    );
  });
});
