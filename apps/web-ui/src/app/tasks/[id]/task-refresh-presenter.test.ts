import { describe, it, expect } from "vitest";
import {
  COORDINATED_POLL_MS,
  EVENT_REFRESH_MIN_GAP_MS,
  STREAM_HEARTBEAT_POLL_MS,
  eventRefreshDelayMs,
  maxEventId,
  pickLiveRun,
  refreshIntervalMs,
  resolveRefreshDriver,
  runDiscoveryActive,
  type LiveRunCandidate,
} from "./task-refresh-presenter";

function run(overrides: Partial<LiveRunCandidate> = {}): LiveRunCandidate {
  return {
    id: "run-1",
    status: "running",
    created_at: "2026-08-01T10:00:00Z",
    ...overrides,
  };
}

describe("pickLiveRun", () => {
  it("returns null for an empty run list", () => {
    expect(pickLiveRun([])).toBe(null);
  });

  it("returns null when every run is finished or failed", () => {
    expect(
      pickLiveRun([
        run({ id: "a", status: "finished" }),
        run({ id: "b", status: "failed" }),
      ]),
    ).toBe(null);
  });

  it("returns the only running run's id", () => {
    expect(
      pickLiveRun([
        run({ id: "a", status: "finished" }),
        run({ id: "b", status: "running" }),
      ]),
    ).toBe("b");
  });

  it("returns the newest non-terminal run from an unsorted list", () => {
    expect(
      pickLiveRun([
        run({
          id: "old",
          status: "queued",
          created_at: "2026-08-01T09:00:00Z",
        }),
        run({
          id: "new",
          status: "running",
          created_at: "2026-08-01T11:00:00Z",
        }),
        run({
          id: "done",
          status: "finished",
          created_at: "2026-08-01T12:00:00Z",
        }),
      ]),
    ).toBe("new");
  });

  it("accepts a queued run as live", () => {
    expect(pickLiveRun([run({ id: "q", status: "queued" })])).toBe("q");
  });

  it("sorts rows whose created_at is a Date object", () => {
    expect(
      pickLiveRun([
        run({
          id: "stale",
          status: "running",
          created_at: new Date("2026-08-01T09:00:00Z"),
        }),
        run({
          id: "fresh",
          status: "running",
          created_at: new Date("2026-08-01T11:00:00Z"),
        }),
      ]),
    ).toBe("fresh");
  });
});

describe("resolveRefreshDriver", () => {
  it("returns idle when no panel is active even with a live run", () => {
    expect(
      resolveRefreshDriver({
        liveRunId: "run-1",
        eventSourceAvailable: true,
        streamUnavailable: false,
        anyPanelActive: false,
      }),
    ).toBe("idle");
  });

  it("returns poll when there is no live run", () => {
    expect(
      resolveRefreshDriver({
        liveRunId: null,
        eventSourceAvailable: true,
        streamUnavailable: false,
        anyPanelActive: true,
      }),
    ).toBe("poll");
  });

  it("returns poll when EventSource is unavailable", () => {
    expect(
      resolveRefreshDriver({
        liveRunId: "run-1",
        eventSourceAvailable: false,
        streamUnavailable: false,
        anyPanelActive: true,
      }),
    ).toBe("poll");
  });

  it("returns poll once the stream has given up", () => {
    expect(
      resolveRefreshDriver({
        liveRunId: "run-1",
        eventSourceAvailable: true,
        streamUnavailable: true,
        anyPanelActive: true,
      }),
    ).toBe("poll");
  });

  it("returns stream for a live run with EventSource available", () => {
    expect(
      resolveRefreshDriver({
        liveRunId: "run-1",
        eventSourceAvailable: true,
        streamUnavailable: false,
        anyPanelActive: true,
      }),
    ).toBe("stream");
  });
});

describe("refreshIntervalMs", () => {
  it("returns null for the idle driver", () => {
    expect(refreshIntervalMs("idle", "live")).toBe(null);
  });

  it("returns the heartbeat cadence for a live stream", () => {
    expect(refreshIntervalMs("stream", "live")).toBe(STREAM_HEARTBEAT_POLL_MS);
  });

  it("returns the coordinated cadence for a stream still connecting", () => {
    expect(refreshIntervalMs("stream", "connecting")).toBe(COORDINATED_POLL_MS);
  });

  it("returns the coordinated cadence for a reconnecting stream", () => {
    expect(refreshIntervalMs("stream", "reconnecting")).toBe(
      COORDINATED_POLL_MS,
    );
  });

  it("returns the coordinated cadence for the poll driver", () => {
    expect(refreshIntervalMs("poll", "offline")).toBe(COORDINATED_POLL_MS);
  });
});

describe("eventRefreshDelayMs", () => {
  it("returns the remaining window when the last refresh was 1s ago", () => {
    expect(eventRefreshDelayMs(10_000, 11_000)).toBe(
      EVENT_REFRESH_MIN_GAP_MS - 1_000,
    );
  });

  it("returns 0 exactly at the min gap", () => {
    expect(eventRefreshDelayMs(10_000, 10_000 + EVENT_REFRESH_MIN_GAP_MS)).toBe(
      0,
    );
  });

  it("returns 0 when the gap exceeds the minimum", () => {
    expect(eventRefreshDelayMs(0, EVENT_REFRESH_MIN_GAP_MS + 1)).toBe(0);
  });
});

describe("maxEventId", () => {
  it("returns 10 over 9 despite lexicographic order", () => {
    expect(maxEventId("9", "10")).toBe("10");
  });

  it("keeps the current cursor when the candidate is smaller", () => {
    expect(maxEventId("42", "7")).toBe("42");
  });

  it("keeps the current cursor for a non-numeric candidate", () => {
    expect(maxEventId("42", "not-a-number")).toBe("42");
  });

  it("handles ids beyond Number.MAX_SAFE_INTEGER", () => {
    expect(maxEventId("9007199254740993", "9007199254740992")).toBe(
      "9007199254740993",
    );
  });
});

describe("runDiscoveryActive", () => {
  it("returns true for a pending task with active panels and no run", () => {
    expect(
      runDiscoveryActive({
        liveRunId: null,
        taskStatus: "pending",
        anyPanelActive: true,
      }),
    ).toBe(true);
  });

  it("returns true while a run is attached so its terminality is re-checked", () => {
    expect(
      runDiscoveryActive({
        liveRunId: "run-1",
        taskStatus: "running",
        anyPanelActive: true,
      }),
    ).toBe(true);
  });

  it("returns true for an attached run even on a terminal task status", () => {
    expect(
      runDiscoveryActive({
        liveRunId: "run-1",
        taskStatus: "failed",
        anyPanelActive: true,
      }),
    ).toBe(true);
  });

  it("returns false for a terminal task status with no attached run", () => {
    expect(
      runDiscoveryActive({
        liveRunId: null,
        taskStatus: "failed",
        anyPanelActive: true,
      }),
    ).toBe(false);
  });

  it("returns false when no panel is active", () => {
    expect(
      runDiscoveryActive({
        liveRunId: null,
        taskStatus: "running",
        anyPanelActive: false,
      }),
    ).toBe(false);
  });
});
