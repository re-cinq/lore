import { describe, expect, it } from "vitest";
import { cronTickEventNames } from "./cron-emitters.js";

describe("cronTickEventNames", () => {
  it("names no tick for gap_detection, spec_drift, spec_coverage_backfill or spec_coverage_validate, whose lines only the old Floor walked", () => {
    const removed = [
      "cron.gap_detection.tick",
      "cron.spec_drift.tick",
      "cron.spec_coverage_backfill.tick",
      "cron.spec_coverage_validate.tick",
    ];

    expect(
      cronTickEventNames().filter((name) => removed.includes(name)),
    ).toEqual([]);
  });

  it("still names cron.spec_upkeep.tick, the weekly line that replaced the drift and backfill fan-outs", () => {
    expect(cronTickEventNames()).toContain("cron.spec_upkeep.tick");
  });
});
