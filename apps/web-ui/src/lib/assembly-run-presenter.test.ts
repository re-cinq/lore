import { describe, it, expect } from "vitest";
import {
  formatRelativeTime,
  formatDuration,
  formatShortAge,
  runHeaderVisual,
  runStatusVisual,
} from "./assembly-run-presenter";

describe("formatRelativeTime", () => {
  const now = Date.parse("2026-07-14T12:00:00Z");

  it("pluralises minutes, hours, days, months and years", () => {
    const at = (ms: number) => new Date(now - ms).toISOString();

    expect(formatRelativeTime(at(90_000), now)).toBe("1 minute ago");
    expect(formatRelativeTime(at(7_200_000), now)).toBe("2 hours ago");
    expect(formatRelativeTime(at(3 * 86_400_000), now)).toBe("3 days ago");
    expect(formatRelativeTime(at(60 * 86_400_000), now)).toBe("2 months ago");
    expect(formatRelativeTime(at(400 * 86_400_000), now)).toBe("1 year ago");
  });

  it("reads just now under a minute", () => {
    expect(formatRelativeTime(new Date(now - 5_000).toISOString(), now)).toBe(
      "just now",
    );
  });
});

describe("formatShortAge", () => {
  const now = Date.parse("2026-07-14T12:00:00Z");
  const at = (ms: number) => new Date(now - ms).toISOString();

  it("renders 8 hours as 8h, 20 days as 20d and 400 days as 1y", () => {
    const ages = {
      minute: formatShortAge(at(90_000), now),
      hours: formatShortAge(at(8 * 3_600_000), now),
      days: formatShortAge(at(20 * 86_400_000), now),
      months: formatShortAge(at(60 * 86_400_000), now),
      year: formatShortAge(at(400 * 86_400_000), now),
    };

    expect(ages).toEqual({
      minute: "1m",
      hours: "8h",
      days: "20d",
      months: "2mo",
      year: "1y",
    });
  });

  it("renders now under a minute", () => {
    expect(formatShortAge(at(5_000), now)).toBe("now");
  });
});

describe("formatDuration", () => {
  it("renders 42 as 42s and 715 as 11m 55s", () => {
    expect(formatDuration(42)).toBe("42s");
    expect(formatDuration(715)).toBe("11m 55s");
  });

  it("renders an em dash for an unknown (null) duration", () => {
    expect(formatDuration(null)).toBe("—");
  });
});

describe("runStatusVisual", () => {
  it("reads a running run that only a person holds as Waiting for you", () => {
    expect(
      runHeaderVisual({ status: "running", outcome: null }, "Waiting for you"),
    ).toEqual({
      label: "Waiting for you",
      tone: "info",
    });
  });

  it("reads a running run nobody is waited on as Running", () => {
    expect(runHeaderVisual({ status: "running", outcome: null }, null)).toEqual(
      {
        label: "Running",
        tone: "running",
      },
    );
  });

  it("reads a finished run by its outcome even when a waiting label is passed", () => {
    expect(
      runHeaderVisual(
        { status: "finished", outcome: "completed" },
        "Waiting for you",
      ).label,
    ).toBe("Completed");
  });

  it("maps finished + completed to a success tone", () => {
    expect(runStatusVisual("finished", "completed")).toEqual({
      label: "Completed",
      tone: "success",
    });
  });

  it("maps finished + iteration_max to a warning tone", () => {
    expect(runStatusVisual("finished", "iteration_max")).toEqual({
      label: "Iteration max",
      tone: "warning",
    });
  });

  it("maps finished + lease_held to a muted skipped tone", () => {
    expect(runStatusVisual("finished", "lease_held")).toEqual({
      label: "Skipped",
      tone: "muted",
    });
  });

  it("maps a finished-but-failed run to a danger tone (not green), since the pg adapter maps only outcome 'error' to status 'failed'", () => {
    expect(runStatusVisual("finished", "failed")).toEqual({
      label: "Failed",
      tone: "danger",
    });
    expect(runStatusVisual("finished", "pr_closed")).toEqual({
      label: "PR closed",
      tone: "muted",
    });
  });

  it("maps finished + pr_created, no_changes and pending to their tones", () => {
    expect(runStatusVisual("finished", "pr_created")).toEqual({
      label: "PR created",
      tone: "success",
    });
    expect(runStatusVisual("finished", "no_changes")).toEqual({
      label: "No changes",
      tone: "muted",
    });
    expect(runStatusVisual("finished", "pending")).toEqual({
      label: "Pending",
      tone: "info",
    });
  });

  it("keeps an unknown finished outcome neutral, never success", () => {
    expect(runStatusVisual("finished", "some_future_outcome")).toEqual({
      label: "some_future_outcome",
      tone: "muted",
    });
  });

  it("maps queued to muted and failed to danger regardless of outcome", () => {
    expect(runStatusVisual("queued", null)).toEqual({
      label: "Queued",
      tone: "muted",
    });
    expect(runStatusVisual("failed", "error")).toEqual({
      label: "Failed",
      tone: "danger",
    });
  });

  it("maps running to a running tone", () => {
    expect(runStatusVisual("running", null).tone).toBe("running");
  });
});
