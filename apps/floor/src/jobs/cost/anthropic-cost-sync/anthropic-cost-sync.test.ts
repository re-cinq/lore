import { describe, it, expect, afterEach } from "vitest";
import { anthropicCostSyncJob, reportWindow } from "./anthropic-cost-sync.js";

describe("anthropicCostSyncJob", () => {
  afterEach(() => {
    delete process.env.ANTHROPIC_ADMIN_KEY;
  });

  it("returns a skip summary without throwing when ANTHROPIC_ADMIN_KEY is unset", async () => {
    delete process.env.ANTHROPIC_ADMIN_KEY;
    expect(await anthropicCostSyncJob()).toMatch(/ANTHROPIC_ADMIN_KEY not set/);
  });
});

const DAY_MS = 24 * 60 * 60 * 1000;
const buckets = (w: { starting_at: string; ending_at: string }) =>
  (Date.parse(w.ending_at) - Date.parse(w.starting_at)) / DAY_MS;

describe("reportWindow", () => {
  it("spans exactly 31 daily buckets, the documented maximum for 1d", () => {
    expect(buckets(reportWindow(new Date("2026-08-10T13:00:00.000Z")))).toBe(
      31,
    );
  });

  it("ends at tomorrow's UTC midnight so the in-progress day is included", () => {
    expect(reportWindow(new Date("2026-08-10T13:00:00.000Z"))).toEqual({
      starting_at: "2026-07-11T00:00:00.000Z",
      ending_at: "2026-08-11T00:00:00.000Z",
    });
  });

  it("aligns both bounds to UTC midnight regardless of the time of day", () => {
    const early = reportWindow(new Date("2026-08-10T00:00:01.000Z"));
    const late = reportWindow(new Date("2026-08-10T23:59:59.000Z"));

    expect(early).toEqual(late);
  });

  it("still covers the first of the month on the 31st, so month-to-date is whole", () => {
    expect(reportWindow(new Date("2026-08-31T09:00:00.000Z")).starting_at).toBe(
      "2026-08-01T00:00:00.000Z",
    );
  });

  it("spans a UTC month boundary without losing a bucket", () => {
    expect(buckets(reportWindow(new Date("2026-03-01T12:00:00.000Z")))).toBe(
      31,
    );
  });
});
