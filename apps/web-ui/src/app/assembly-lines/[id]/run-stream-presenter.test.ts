import { describe, it, expect } from "vitest";
import {
  HISTORY_PAGE_LIMIT,
  connectionLabel,
  historyUrl,
  isTerminalRunStatus,
  nextPageCursor,
  reconnectDelayMs,
  resolveStreamMode,
  streamUrl,
} from "./run-stream-presenter";

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
