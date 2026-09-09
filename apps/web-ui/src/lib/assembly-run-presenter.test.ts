import { describe, it, expect } from "vitest";
import {
  formatRelativeTime,
  formatDuration,
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
