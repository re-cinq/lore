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
// Candidate daily buckets between the window's start and the END of the given
// day — what the API can return for this request, since the window is open.
const candidates = (w: { starting_at: string }, now: string) => {
  const day = new Date(now);
  const endOfToday =
    Date.UTC(day.getUTCFullYear(), day.getUTCMonth(), day.getUTCDate()) +
    DAY_MS;

  return (endOfToday - Date.parse(w.starting_at)) / DAY_MS;
};

describe("reportWindow", () => {
  it("leaves exactly 31 candidate buckets through the end of today, so limit 31 never truncates", () => {
    const now = "2026-08-10T13:00:00.000Z";

    expect(candidates(reportWindow(new Date(now)), now)).toBe(31);
  });

  it("starts 30 days before today's UTC midnight", () => {
    expect(reportWindow(new Date("2026-08-10T13:00:00.000Z"))).toEqual({
      starting_at: "2026-07-11T00:00:00.000Z",
    });
  });

  it("sends no ending_at, whose strictly-before semantics would exclude the current day", () => {
    expect(
      reportWindow(new Date("2026-08-10T13:00:00.000Z")),
    ).not.toHaveProperty("ending_at");
  });

  it("aligns the start to UTC midnight regardless of the time of day", () => {
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
    const now = "2026-03-01T12:00:00.000Z";

    expect(candidates(reportWindow(new Date(now)), now)).toBe(31);
  });
});
