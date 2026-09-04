// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { renderHook, act, waitFor } from "@testing-library/react";
import { useRunHistory, useHistoryPoll } from "./use-run-history";
import type { RunStreamEvent } from "@/lib/run-stream-types";

function row(id: string): Record<string, unknown> {
  return {
    id,
    taskId: "t1",
    agentCrName: null,
    assemblyLineId: "al",
    stationRunId: null,
    nodeId: "implement",
    iteration: 1,
    eventType: "message",
    toolName: null,
    toolUseId: null,
    isError: false,
    filePaths: [],
    summary: null,
    payload: {},
    createdAt: "2026-07-14T10:00:00Z",
  };
}

function stubFetch(...pages: unknown[][]) {
  let call = 0;
  const fetchStub = vi.fn(async () => {
    const events = pages[Math.min(call, pages.length - 1)];

    call += 1;

    return { ok: true, json: async () => ({ events }) } as Response;
  });

  global.fetch = fetchStub as unknown as typeof fetch;

  return fetchStub;
}

describe("useRunHistory", () => {
  it("folds a single short page into historyEvents and marks the run loaded", async () => {
    stubFetch([row("1"), row("2")]);
    const dispatch = vi.fn();
    const { result } = renderHook(() => useRunHistory("run-1", dispatch));

    await waitFor(() => expect(result.current.historyLoadedFor).toBe("run-1"));

    expect(result.current.historyEvents.map((e) => e.id)).toEqual(["1", "2"]);
    expect(dispatch).toHaveBeenCalledTimes(2);
    expect(result.current.streamUnavailable).toBe(false);
  });

  it("marks the connection offline when the history fetch fails", async () => {
    global.fetch = vi.fn(async () => ({
      ok: false,
    })) as unknown as typeof fetch;
    const dispatch = vi.fn();
    const { result } = renderHook(() => useRunHistory("run-1", dispatch));

    await waitFor(() => expect(result.current.streamUnavailable).toBe(true));

    expect(result.current.connection).toBe("offline");
    expect(result.current.historyLoadedFor).toBeNull();
  });
});

describe("useHistoryPoll", () => {
  beforeEach(() => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("dispatches parsed rows fetched on each poll tick while active", async () => {
    const fetchStub = stubFetch([row("5")]);
    const dispatch = vi.fn();

    renderHook(() =>
      useHistoryPoll(
        true,
        "run-1",
        "4",
        dispatch as (e: RunStreamEvent) => void,
      ),
    );

    await act(async () => {
      await vi.advanceTimersByTimeAsync(15000);
    });

    expect(fetchStub).toHaveBeenCalledTimes(1);
    expect(dispatch).toHaveBeenCalledWith(expect.objectContaining({ id: "5" }));
  });

  it("does not poll while inactive", async () => {
    const fetchStub = stubFetch([row("5")]);
    const dispatch = vi.fn();

    renderHook(() => useHistoryPoll(false, "run-1", "4", dispatch));

    await act(async () => {
      await vi.advanceTimersByTimeAsync(30000);
    });

    expect(fetchStub).not.toHaveBeenCalled();
  });
});
