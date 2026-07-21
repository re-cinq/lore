import { describe, it, expect } from "vitest";
import {
  HISTORY_PAGE_LIMIT,
  connectionLabel,
  cursorForEventId,
  historyUrl,
  isTerminalRunStatus,
  nextPageCursor,
  reconnectDelayMs,
  resolveStreamMode,
  scrubberPositionLabel,
  streamUrl,
} from "./run-stream-presenter";
import type { RunStreamEvent } from "@/lib/run-stream-types";

describe("historyUrl", () => {
  it("returns the events path with after and limit for cursor 42", () => {
    expect(historyUrl("run-1", "42")).toBe(
      `/api/assembly-lines/run-1/events?limit=${HISTORY_PAGE_LIMIT}&after=42`,
    );
  });

  it("omits the after param from the events path for cursor 0", () => {
    expect(historyUrl("run-1", "0")).toBe(
      `/api/assembly-lines/run-1/events?limit=${HISTORY_PAGE_LIMIT}`,
    );
  });

  it("encodes a run id containing a slash", () => {
    expect(historyUrl("a/b", "0")).toContain("a%2Fb");
  });
});

describe("streamUrl", () => {
  it("returns the stream path with after for cursor 42", () => {
    expect(streamUrl("run-1", "42")).toBe(
      "/api/assembly-lines/run-1/events/stream?after=42",
    );
  });

  it("omits the after param from the stream path for cursor 0", () => {
    expect(streamUrl("run-1", "0")).toBe(
      "/api/assembly-lines/run-1/events/stream",
    );
  });
});

describe("isTerminalRunStatus", () => {
  it("returns true for run status finished", () => {
    expect(isTerminalRunStatus("finished")).toBe(true);
  });

  it("returns true for run status failed", () => {
    expect(isTerminalRunStatus("failed")).toBe(true);
  });

  it("returns false for run status running", () => {
    expect(isTerminalRunStatus("running")).toBe(false);
  });

  it("returns false for run status queued", () => {
    expect(isTerminalRunStatus("queued")).toBe(false);
  });
});

describe("nextPageCursor", () => {
  it("returns the last row id when the page fills the limit", () => {
    const page = Array.from({ length: HISTORY_PAGE_LIMIT }, (_, i) => ({
      id: String(i + 1),
    }));

    expect(nextPageCursor(page)).toBe(String(HISTORY_PAGE_LIMIT));
  });

  it("returns null when the page is shorter than the limit", () => {
    expect(nextPageCursor([{ id: "1" }, { id: "2" }])).toBeNull();
  });

  it("returns null for an empty page", () => {
    expect(nextPageCursor([])).toBeNull();
  });
});

describe("reconnectDelayMs", () => {
  it("returns 1000 for reconnect attempt 1", () => {
    expect(reconnectDelayMs(1)).toBe(1000);
  });

  it("returns 2000 for reconnect attempt 2", () => {
    expect(reconnectDelayMs(2)).toBe(2000);
  });

  it("caps the reconnect delay at 30000 for attempt 10", () => {
    expect(reconnectDelayMs(10)).toBe(30000);
  });

  it("returns 1000 for attempt 0", () => {
    expect(reconnectDelayMs(0)).toBe(1000);
  });
});

describe("connectionLabel", () => {
  it("returns Live for connection state live", () => {
    expect(connectionLabel("live")).toBe("Live");
  });

  it("returns Connecting for connection state connecting", () => {
    expect(connectionLabel("connecting")).toBe("Connecting");
  });

  it("returns Reconnecting for connection state reconnecting", () => {
    expect(connectionLabel("reconnecting")).toBe("Reconnecting");
  });

  it("returns Offline for connection state offline", () => {
    expect(connectionLabel("offline")).toBe("Offline");
  });
});

describe("resolveStreamMode", () => {
  it("returns live for a running run when EventSource is available", () => {
    expect(
      resolveStreamMode({
        runStatus: "running",
        eventSourceAvailable: true,
        streamUnavailable: false,
      }),
    ).toBe("live");
  });

  it("returns history-only when EventSource is unavailable", () => {
    expect(
      resolveStreamMode({
        runStatus: "running",
        eventSourceAvailable: false,
        streamUnavailable: false,
      }),
    ).toBe("history-only");
  });

  it("returns history-only for a finished run even when EventSource is available", () => {
    expect(
      resolveStreamMode({
        runStatus: "finished",
        eventSourceAvailable: true,
        streamUnavailable: false,
      }),
    ).toBe("history-only");
  });

  it("returns history-only once the stream reported itself unavailable", () => {
    expect(
      resolveStreamMode({
        runStatus: "running",
        eventSourceAvailable: true,
        streamUnavailable: true,
      }),
    ).toBe("history-only");
  });
});

function scrubEvent(over: Partial<RunStreamEvent> = {}): RunStreamEvent {
  return {
    id: "1",
    taskId: "task-1",
    agentCrName: null,
    assemblyLineId: "run-1",
    nodeId: "implement",
    iteration: 1,
    eventType: "init",
    toolName: null,
    toolUseId: null,
    isError: false,
    filePaths: [],
    summary: null,
    payload: {},
    createdAt: "2026-07-20T10:00:00.000Z",
    ...over,
  };
}

describe("cursorForEventId", () => {
  const events = [
    scrubEvent({ id: "3" }),
    scrubEvent({ id: "4" }),
    scrubEvent({ id: "9" }),
  ];

  it("maps a timeline event id to the cursor that includes that event", () => {
    expect(cursorForEventId(events, "4")).toBe(2);
  });

  it("maps the first event id to a cursor of one", () => {
    expect(cursorForEventId(events, "3")).toBe(1);
  });

  it("maps the last event id to a cursor equal to the event count", () => {
    expect(cursorForEventId(events, "9")).toBe(events.length);
  });

  it("returns null for an id absent from the events", () => {
    expect(cursorForEventId(events, "42")).toBeNull();
  });

  it("returns null for an empty event list", () => {
    expect(cursorForEventId([], "3")).toBeNull();
  });
});

describe("scrubberPositionLabel", () => {
  const events = [
    scrubEvent({ id: "1", createdAt: "2026-07-20T10:00:00.000Z" }),
    scrubEvent({ id: "2", createdAt: "2026-07-20T10:05:00.000Z" }),
    scrubEvent({ id: "3", createdAt: "2026-07-20T10:10:00.000Z" }),
  ];

  it("labels the position as event N of M with the last applied event timestamp", () => {
    expect(scrubberPositionLabel(events, 2)).toEqual({
      label: "event 2 / 3",
      timestamp: "2026-07-20T10:05:00.000Z",
    });
  });

  it("reports a null timestamp at cursor zero before any event applies", () => {
    expect(scrubberPositionLabel(events, 0)).toEqual({
      label: "event 0 / 3",
      timestamp: null,
    });
  });

  it("clamps a cursor past the end to the event count", () => {
    expect(scrubberPositionLabel(events, 99)).toEqual({
      label: "event 3 / 3",
      timestamp: "2026-07-20T10:10:00.000Z",
    });
  });

  it("clamps a negative cursor to zero", () => {
    expect(scrubberPositionLabel(events, -4)).toEqual({
      label: "event 0 / 3",
      timestamp: null,
    });
  });
});
