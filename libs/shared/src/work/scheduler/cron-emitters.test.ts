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

  it("names no tick that only the old Floor answered: stale_task_check, assembly_line_reaper, agent_watcher_reconcile, lease_reaper, llm_credit_probe", () => {
    const floorOnly = [
      "cron.stale_task_check.tick",
      "cron.assembly_line_reaper.tick",
      "cron.agent_watcher_reconcile.tick",
      "cron.lease_reaper.tick",
      "cron.llm_credit_probe.tick",
    ];

    expect(
      cronTickEventNames().filter((name) => floorOnly.includes(name)),
    ).toEqual([]);
  });
  it("names no tick for spec_task_executor, the second dispatcher the backlog implementation loop replaced", () => {
    expect(cronTickEventNames()).not.toContain("cron.spec_task_executor.tick");
  });
});
