import { describe, expect, it } from "vitest";
import { InMemoryBaseline } from "@re-cinq/lore-shared/project/baseline/baseline-memory.js";
import {
  captureBaselineForRepo,
  shouldCaptureBaseline,
} from "./baseline-capture.js";

describe("shouldCaptureBaseline", () => {
  it("captures when a repo turns dark mode on for the first time", () => {
    expect(shouldCaptureBaseline({}, { enabled: true })).toBe(true);
  });

  it("captures when enabled goes explicitly false to true", () => {
    expect(shouldCaptureBaseline({ enabled: false }, { enabled: true })).toBe(
      true,
    );
  });

  it("does not capture on a write that leaves dark mode already on", () => {
    expect(shouldCaptureBaseline({ enabled: true }, { enabled: true })).toBe(
      false,
    );
  });

  it("does not capture when dark mode is turned off", () => {
    expect(shouldCaptureBaseline({ enabled: true }, { enabled: false })).toBe(
      false,
    );
  });

  it("does not capture on an unrelated edit while dark mode is off", () => {
    expect(
      shouldCaptureBaseline(
        { enabled: false, review: "bot" },
        { enabled: false, review: "human" },
      ),
    ).toBe(false);
  });
});

describe("captureBaselineForRepo", () => {
  const NOW = new Date("2026-06-30T00:00:00.000Z");
  const DAY = 86_400_000;
  const daysBefore = (n: number) => new Date(NOW.getTime() - n * DAY);

  const task = (repo: string, createdDaysAgo: number, ttmHours: number) => ({
    target_repo: repo,
    created_at: daysBefore(createdDaysAgo),
    updated_at: new Date(
      daysBefore(createdDaysAgo).getTime() + ttmHours * 3_600_000,
    ),
    pr_url: "https://github.com/o/r/pull/1",
  });

  it("writes one snapshot row spanning the window ending now", async () => {
    const store = new InMemoryBaseline([]);

    await captureBaselineForRepo("o/r", store, 30, NOW);

    expect(store.rows).toMatchObject([
      { repo: "o/r", window_start: daysBefore(30), window_end: NOW },
    ]);
  });

  it("scales the issue count to a weekly rate over the window", async () => {
    const store = new InMemoryBaseline(
      Array.from({ length: 12 }, (_, i) => task("o/r", i + 1, 4)),
    );

    await captureBaselineForRepo("o/r", store, 30, NOW);

    expect(store.rows[0]?.counters.issues_per_week).toBeCloseTo(2.8, 5);
  });

  it("counts only the requested repo's tasks", async () => {
    const store = new InMemoryBaseline([
      task("o/r", 5, 4),
      task("o/other", 5, 4),
    ]);

    await captureBaselineForRepo("o/r", store, 30, NOW);

    expect(store.rows[0]?.counters.issues_per_week).toBeCloseTo(7 / 30, 5);
  });

  it("ignores tasks older than the window", async () => {
    const store = new InMemoryBaseline([task("o/r", 90, 4)]);

    await captureBaselineForRepo("o/r", store, 30, NOW);

    expect(store.rows[0]?.counters.issues_per_week).toBe(0);
  });

  it("flags the job-pod count as a static baseline, not a measurement", async () => {
    const store = new InMemoryBaseline([]);

    await captureBaselineForRepo("o/r", store, 30, NOW);

    expect(store.rows[0]?.counters).toMatchObject({
      job_pods_per_impl_task_p50: 4,
      _job_pods_source: "static_baseline",
    });
  });
});
