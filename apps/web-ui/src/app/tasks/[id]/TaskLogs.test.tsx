// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, act, fireEvent } from "@testing-library/react";
import TaskLogs from "./TaskLogs";
import TaskRefreshProvider from "./TaskRefreshProvider";
import {
  ASSISTANT_TEXT,
  ASSISTANT_THINKING,
  LIFECYCLE_STARTED,
  LIFECYCLE_SUCCEEDED,
  RESULT_TERMINAL,
  SESSION_INIT,
  STATION_LOG,
  THINKING_TOKENS_11,
  THINKING_TOKENS_21,
  THINKING_TOKENS_444,
  TOOL_RESULT_ERROR,
  TOOL_RESULT_OK,
  TOOL_USE_BASH,
  TOOL_USE_SKILL,
  USER_PROMPT,
} from "@/lib/agent-log-entries.fixtures";
import { TURNS_PAGE_LIMIT } from "@/app/assembly-runs/[id]/turn-transcript-presenter";

// The coordinated interval now lives in TaskRefreshProvider, so timer-driven
// tests render inside it (taskStatus "done" keeps run discovery off; jsdom has
// no EventSource, so the provider stays in poll mode).
function renderWithRefresh(ui: React.ReactElement) {
  return render(
    <TaskRefreshProvider taskId="t1" taskStatus="done" runs={[]}>
      {ui}
    </TaskRefreshProvider>,
  );
}

// jsdom does not implement scrollIntoView; the auto-scroll effect calls it on every turns change.
beforeEach(() => {
  Element.prototype.scrollIntoView = vi.fn();
});

afterEach(() => {
  vi.useRealTimers();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

let nextTurnId = 0;

// One stored turn row as the proxy serves it: the untruncated {source, event}
// envelope plus correlation fields (mirrors AgentRunTurnRow's JSON projection).
function turnRow(
  line: string,
  over: Partial<{
    id: string;
    nodeId: string | null;
    iteration: number | null;
  }> = {},
) {
  nextTurnId += 1;

  return {
    id: over.id ?? String(nextTurnId),
    taskId: "t1",
    agentCrName: "cr-1",
    assemblyLineId: null,
    nodeId: over.nodeId ?? null,
    iteration: over.iteration ?? null,
    stationRunId: null,
    eventType: null,
    envelope: { source: { agent: "cr-1" }, event: JSON.parse(line) },
    createdAt: "2026-08-18T00:00:00.000Z",
  };
}

function turnsResponse(
  turns: unknown[],
  taskStatus: string,
  init: { ok?: boolean; status?: number } = {},
) {
  return {
    ok: init.ok ?? true,
    status: init.status ?? 200,
    headers: {
      get: (name: string) => (name === "X-Task-Status" ? taskStatus : null),
    },
    json: async () => ({ turns }),
    text: async () => JSON.stringify({ turns }),
  };
}

// Flush the pending fetch().then() microtask chain so the state setters run inside act().
// The cursor walk chains several hops per page (fetch -> json -> setState -> next page),
// so loop until quiet.
async function settle() {
  for (let i = 0; i < 12; i++) {
    await act(async () => {
      await Promise.resolve();
    });
  }
}

function afterCalls(fetchMock: ReturnType<typeof vi.fn>): string[] {
  return fetchMock.mock.calls
    .map((c) => c[0] as string)
    .filter((u) => u.includes("after="));
}

// The full production sample as stored turns (the non-JSON runner marker has no
// turn row — the ingest only stores stream-json lines).
function sampleTurns() {
  return [
    LIFECYCLE_STARTED,
    SESSION_INIT,
    THINKING_TOKENS_11,
    THINKING_TOKENS_21,
    ASSISTANT_THINKING,
    TOOL_USE_SKILL,
    TOOL_RESULT_OK,
    USER_PROMPT,
    THINKING_TOKENS_444,
    ASSISTANT_TEXT,
    TOOL_USE_BASH,
    TOOL_RESULT_ERROR,
    STATION_LOG,
    RESULT_TERMINAL,
    LIFECYCLE_SUCCEEDED,
  ].map((line) => turnRow(line));
}

describe("TaskLogs", () => {
  it("renders the empty placeholder before any turns resolve", async () => {
    const fetchMock = vi.fn().mockResolvedValue(turnsResponse([], "queued"));

    vi.stubGlobal("fetch", fetchMock);

    render(<TaskLogs taskId="t1" initialStatus="queued" />);
    expect(
      screen.getByText("Logs will appear when the agent starts."),
    ).toBeInTheDocument();

    await settle();
    // Zero turns on a not-yet-terminal task → the agent has emitted nothing
    // yet, so the placeholder remains.
    expect(
      screen.getByText("Logs will appear when the agent starts."),
    ).toBeInTheDocument();
  });

  it("requests the page-limit URL with no after param on the initial fetch", async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValue(turnsResponse([turnRow(ASSISTANT_TEXT)], "succeeded"));

    vi.stubGlobal("fetch", fetchMock);

    render(<TaskLogs taskId="abc" initialStatus="succeeded" />);
    await settle();

    expect(fetchMock).toHaveBeenCalledWith(
      `/api/tasks/abc/logs?limit=${TURNS_PAGE_LIMIT}`,
      expect.objectContaining({ signal: expect.anything() }),
    );
    expect(afterCalls(fetchMock)).toHaveLength(0);
  });

  it("renders fetched turns in the terminal block after the first resolved fetch", async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValue(turnsResponse([turnRow(ASSISTANT_TEXT)], "succeeded"));

    vi.stubGlobal("fetch", fetchMock);

    render(<TaskLogs taskId="t1" initialStatus="queued" />);
    await settle();

    expect(
      screen.getByText(/fetch the PR metadata and diff/),
    ).toBeInTheDocument();
    expect(
      screen.queryByText("Logs will appear when the agent starts."),
    ).not.toBeInTheDocument();
  });

  it("shows the Completed badge for succeeded status", async () => {
    vi.stubGlobal(
      "fetch",
      vi
        .fn()
        .mockResolvedValue(
          turnsResponse([turnRow(ASSISTANT_TEXT)], "succeeded"),
        ),
    );
    render(<TaskLogs taskId="t1" initialStatus="succeeded" />);
    await settle();
    expect(screen.getByText("Completed")).toBeInTheDocument();
  });

  it("shows the Completed badge for pr-created status", async () => {
    vi.stubGlobal(
      "fetch",
      vi
        .fn()
        .mockResolvedValue(
          turnsResponse([turnRow(ASSISTANT_TEXT)], "pr-created"),
        ),
    );
    render(<TaskLogs taskId="t1" initialStatus="pr-created" />);
    await settle();
    expect(screen.getByText("Completed")).toBeInTheDocument();
  });

  it("shows the Completed badge for merged status", async () => {
    vi.stubGlobal(
      "fetch",
      vi
        .fn()
        .mockResolvedValue(turnsResponse([turnRow(ASSISTANT_TEXT)], "merged")),
    );
    render(<TaskLogs taskId="t1" initialStatus="merged" />);
    await settle();
    expect(screen.getByText("Completed")).toBeInTheDocument();
  });

  it("shows the In Review badge for review status", async () => {
    vi.stubGlobal(
      "fetch",
      vi
        .fn()
        .mockResolvedValue(turnsResponse([turnRow(ASSISTANT_TEXT)], "review")),
    );
    render(<TaskLogs taskId="t1" initialStatus="review" />);
    await settle();
    expect(screen.getByText("In Review")).toBeInTheDocument();
  });

  it("shows the Failed badge for failed status", async () => {
    vi.stubGlobal(
      "fetch",
      vi
        .fn()
        .mockResolvedValue(turnsResponse([turnRow(ASSISTANT_TEXT)], "failed")),
    );
    render(<TaskLogs taskId="t1" initialStatus="failed" />);
    await settle();
    expect(screen.getByText("Failed")).toBeInTheDocument();
  });

  it("shows the Failed badge for cancelled status", async () => {
    vi.stubGlobal(
      "fetch",
      vi
        .fn()
        .mockResolvedValue(
          turnsResponse([turnRow(ASSISTANT_TEXT)], "cancelled"),
        ),
    );
    render(<TaskLogs taskId="t1" initialStatus="cancelled" />);
    await settle();
    expect(screen.getByText("Failed")).toBeInTheDocument();
  });

  it("renders the pulse indicator and turn-count polling note while running", async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValue(
        turnsResponse(
          [turnRow(ASSISTANT_TEXT), turnRow(STATION_LOG)],
          "running",
        ),
      );

    vi.stubGlobal("fetch", fetchMock);

    const { container } = render(
      <TaskLogs taskId="t1" initialStatus="running" />,
    );

    await settle();

    expect(container.querySelector('span[class*="pulse"]')).not.toBeNull();
    expect(
      screen.getByText(/Auto-refreshing — 2 turns received/),
    ).toBeInTheDocument();
  });

  it("shows the bare refresh note when running with zero turns received", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(turnsResponse([], "running")),
    );
    render(<TaskLogs taskId="t1" initialStatus="running" />);
    await settle();

    const note = screen.getByText("Auto-refreshing");

    expect(note.textContent).toBe("Auto-refreshing");
  });

  it("appends new turns using the after cursor once the first page landed", async () => {
    // First page: two turns. The coordinator's poll then asks after=2 and the
    // server answers one more turn, which the component appends.
    const fetchMock = vi.fn().mockImplementation((url: string) => {
      if (url.includes("after=2")) {
        return Promise.resolve(
          turnsResponse([turnRow(STATION_LOG, { id: "3" })], "running"),
        );
      }

      if (url.includes("after=")) {
        return Promise.resolve(turnsResponse([], "running"));
      }

      return Promise.resolve(
        turnsResponse(
          [
            turnRow(ASSISTANT_TEXT, { id: "1" }),
            turnRow(TOOL_USE_BASH, { id: "2" }),
          ],
          "running",
        ),
      );
    });

    vi.useFakeTimers();
    vi.stubGlobal("fetch", fetchMock);

    renderWithRefresh(<TaskLogs taskId="job9" initialStatus="running" />);
    await settle();

    await act(async () => {
      vi.advanceTimersByTime(10_000);
    });
    await settle();

    expect(afterCalls(fetchMock)).toContain(
      `/api/tasks/job9/logs?limit=${TURNS_PAGE_LIMIT}&after=2`,
    );
    expect(screen.getByText(/detect: scanning 42 specs/)).toBeInTheDocument();
    expect(
      screen.getByText(/fetch the PR metadata and diff/),
    ).toBeInTheDocument();
  });

  it("does not duplicate turns when a poll returns nothing new", async () => {
    const fetchMock = vi.fn().mockImplementation((url: string) => {
      if (url.includes("after=")) {
        return Promise.resolve(turnsResponse([], "running"));
      }

      return Promise.resolve(
        turnsResponse([turnRow(ASSISTANT_TEXT, { id: "1" })], "running"),
      );
    });

    vi.useFakeTimers();
    vi.stubGlobal("fetch", fetchMock);

    renderWithRefresh(<TaskLogs taskId="t1" initialStatus="running" />);
    await settle();
    await act(async () => {
      vi.advanceTimersByTime(10_000);
    });
    await settle();

    expect(afterCalls(fetchMock).length).toBeGreaterThan(0);
    expect(screen.getAllByText(/fetch the PR metadata and diff/)).toHaveLength(
      1,
    );
  });

  it("keeps walking within one fetch while pages come back full", async () => {
    // A page of exactly TURNS_PAGE_LIMIT rows means more may follow: the same
    // fetch cycle immediately asks after=<last id> instead of waiting for the
    // next poll tick.
    const fullPage = Array.from({ length: TURNS_PAGE_LIMIT }, (_, i) =>
      turnRow(STATION_LOG, { id: String(i + 1) }),
    );
    const fetchMock = vi.fn().mockImplementation((url: string) => {
      if (url.includes("after=")) {
        return Promise.resolve(
          turnsResponse([turnRow(ASSISTANT_TEXT, { id: "9001" })], "succeeded"),
        );
      }

      return Promise.resolve(turnsResponse(fullPage, "succeeded"));
    });

    vi.stubGlobal("fetch", fetchMock);

    render(<TaskLogs taskId="t1" initialStatus="succeeded" />);
    await settle();

    expect(afterCalls(fetchMock)).toContain(
      `/api/tasks/t1/logs?limit=${TURNS_PAGE_LIMIT}&after=${TURNS_PAGE_LIMIT}`,
    );
    expect(
      screen.getByText(/fetch the PR metadata and diff/),
    ).toBeInTheDocument();
  });

  it("renders the access-denied message and stops polling on a 403 response", async () => {
    vi.useFakeTimers();
    const fetchMock = vi
      .fn()
      .mockResolvedValue(
        turnsResponse([], "running", { ok: false, status: 403 }),
      );

    vi.stubGlobal("fetch", fetchMock);

    renderWithRefresh(<TaskLogs taskId="t1" initialStatus="running" />);
    await settle();

    expect(
      screen.getByText(
        "Access denied — you do not have access to this repository.",
      ),
    ).toBeInTheDocument();
    expect(
      screen.queryByText("Logs will appear when the agent starts."),
    ).not.toBeInTheDocument();

    const callsAfterDenied = fetchMock.mock.calls.length;

    await act(async () => {
      vi.advanceTimersByTime(15000);
    });
    await settle();
    // accessDenied short-circuits both the interval guard and fetchLogs itself.
    expect(fetchMock.mock.calls.length).toBe(callsAfterDenied);
  });

  it("renders the sign-in message on a 401 response", async () => {
    vi.stubGlobal(
      "fetch",
      vi
        .fn()
        .mockResolvedValue(
          turnsResponse([], "running", { ok: false, status: 401 }),
        ),
    );
    render(<TaskLogs taskId="t1" initialStatus="running" />);
    await settle();

    expect(
      screen.getByText(
        "Failed to load logs: You must be signed in to view logs.",
      ),
    ).toBeInTheDocument();
  });

  it("renders an HTTP error message on a non-ok, non-auth response", async () => {
    vi.stubGlobal(
      "fetch",
      vi
        .fn()
        .mockResolvedValue(
          turnsResponse([], "failed", { ok: false, status: 500 }),
        ),
    );
    render(<TaskLogs taskId="t1" initialStatus="failed" />);
    await settle();

    expect(
      screen.getByText("Failed to load logs: HTTP 500"),
    ).toBeInTheDocument();
  });

  it("renders the rejection message when fetch itself throws", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockRejectedValue(new Error("network down")),
    );
    render(<TaskLogs taskId="t1" initialStatus="queued" />);
    await settle();

    expect(
      screen.getByText("Failed to load logs: network down"),
    ).toBeInTheDocument();
    // The error branch hides both the empty placeholder and the terminal block.
    expect(
      screen.queryByText("Logs will appear when the agent starts."),
    ).not.toBeInTheDocument();
  });

  it("clears the error once a later fetch succeeds", async () => {
    vi.useFakeTimers();
    let failFirst = true;
    const fetchMock = vi.fn().mockImplementation((url: string) => {
      if (failFirst) {
        failFirst = false;

        return Promise.resolve(
          turnsResponse([], "running", { ok: false, status: 500 }),
        );
      }

      if (url.includes("after=")) {
        return Promise.resolve(turnsResponse([], "running"));
      }

      return Promise.resolve(
        turnsResponse([turnRow(STATION_LOG, { id: "1" })], "running"),
      );
    });

    vi.stubGlobal("fetch", fetchMock);

    renderWithRefresh(<TaskLogs taskId="t1" initialStatus="running" />);
    await settle();
    expect(
      screen.getByText("Failed to load logs: HTTP 500"),
    ).toBeInTheDocument();

    await act(async () => {
      vi.advanceTimersByTime(10_000);
    });
    await settle();

    expect(screen.queryByText(/Failed to load logs/)).not.toBeInTheDocument();
    expect(screen.getByText(/detect: scanning 42 specs/)).toBeInTheDocument();
  });

  it("keeps polling on the running interval and stops fetching after unmount", async () => {
    vi.useFakeTimers();
    const fetchMock = vi.fn().mockImplementation((url: string) => {
      if (url.includes("after=")) {
        return Promise.resolve(turnsResponse([], "running"));
      }

      return Promise.resolve(
        turnsResponse([turnRow(STATION_LOG, { id: "1" })], "running"),
      );
    });

    vi.stubGlobal("fetch", fetchMock);

    const { unmount } = renderWithRefresh(
      <TaskLogs taskId="t1" initialStatus="running" />,
    );

    await settle();
    const baseline = fetchMock.mock.calls.length;

    expect(baseline).toBeGreaterThan(0);

    await act(async () => {
      vi.advanceTimersByTime(10_000);
    });
    await settle();
    // The interval fired at least one additional poll.
    expect(fetchMock.mock.calls.length).toBeGreaterThan(baseline);

    unmount();
    const callsAtUnmount = fetchMock.mock.calls.length;

    await act(async () => {
      vi.advanceTimersByTime(20000);
    });
    // clearInterval in the effect cleanup means no fetches fire post-unmount.
    expect(fetchMock.mock.calls.length).toBe(callsAtUnmount);
  });

  it("does not start an interval when the status is terminal", async () => {
    vi.useFakeTimers();
    const fetchMock = vi
      .fn()
      .mockResolvedValue(turnsResponse([turnRow(ASSISTANT_TEXT)], "succeeded"));

    vi.stubGlobal("fetch", fetchMock);

    renderWithRefresh(<TaskLogs taskId="t1" initialStatus="succeeded" />);
    await settle();
    const settledCalls = fetchMock.mock.calls.length;

    await act(async () => {
      vi.advanceTimersByTime(60000);
    });
    await settle();
    // The panel reports inactive for a non-active status → call count is frozen.
    expect(fetchMock.mock.calls.length).toBe(settledCalls);
  });

  it("always renders the Agent Output heading", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(turnsResponse([], "queued")),
    );
    render(<TaskLogs taskId="t1" initialStatus="queued" />);
    expect(
      screen.getByRole("heading", { name: /Agent Output/ }),
    ).toBeInTheDocument();
    await settle();
  });

  it("transitions from running to a done badge when the server reports completion", async () => {
    vi.useFakeTimers();
    let phase = 0;
    const fetchMock = vi.fn().mockImplementation(() => {
      phase += 1;

      // The single mount fetch keeps it running; after the poll, report pr-created.
      if (phase <= 1) {
        return Promise.resolve(
          turnsResponse([turnRow(ASSISTANT_TEXT, { id: "1" })], "running"),
        );
      }

      return Promise.resolve(turnsResponse([], "pr-created"));
    });

    vi.stubGlobal("fetch", fetchMock);

    renderWithRefresh(<TaskLogs taskId="t1" initialStatus="running" />);
    await settle();
    expect(screen.queryByText("Completed")).not.toBeInTheDocument();
    expect(screen.getByText(/Auto-refreshing/)).toBeInTheDocument();

    await act(async () => {
      vi.advanceTimersByTime(10_000);
    });
    await settle();

    expect(screen.getByText("Completed")).toBeInTheDocument();
    // Now terminal → the refresh note disappears.
    expect(screen.queryByText(/Auto-refreshing/)).not.toBeInTheDocument();
  });

  it("shows the no-stored-turns explainer for a finished task with no turns", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(turnsResponse([], "succeeded")),
    );
    render(<TaskLogs taskId="t1" initialStatus="succeeded" />);
    await settle();

    expect(
      screen.getByText(/No stored agent turns for this task/),
    ).toBeInTheDocument();
    expect(
      screen.queryByText("Logs will appear when the agent starts."),
    ).not.toBeInTheDocument();
  });

  it("keeps the placeholder for a running task with no turns yet", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(turnsResponse([], "running")),
    );
    render(<TaskLogs taskId="t1" initialStatus="running" />);
    await settle();

    expect(
      screen.getByText("Logs will appear when the agent starts."),
    ).toBeInTheDocument();
    expect(
      screen.queryByText(/No stored agent turns for this task/),
    ).not.toBeInTheDocument();
  });

  it("renders the sample turns as formatted entries by default", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(turnsResponse(sampleTurns(), "succeeded")),
    );

    render(<TaskLogs taskId="t1" initialStatus="succeeded" />);
    await settle();

    expect(screen.getByText(/^→ Bash: gh pr view 871/)).toBeInTheDocument();
    // The sample carries two thinking_tokens runs → exactly two counters.
    expect(screen.getAllByText(/^thinking… ~/)).toHaveLength(2);
    expect(
      screen.getByText("✓ finished — 3m 21s · $0.51 · 27 turns"),
    ).toBeInTheDocument();
    // The raw JSON ticker lines are gone in formatted mode.
    expect(screen.queryByText(/estimated_tokens/)).not.toBeInTheDocument();
  });

  it("labels each node visit's segment with its node and iteration", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(
        turnsResponse(
          [
            turnRow(ASSISTANT_TEXT, {
              id: "1",
              nodeId: "implement",
              iteration: 1,
            }),
            turnRow(TOOL_USE_BASH, { id: "2", nodeId: "review", iteration: 2 }),
          ],
          "succeeded",
        ),
      ),
    );

    render(<TaskLogs taskId="t1" initialStatus="succeeded" />);
    await settle();

    expect(screen.getByText("implement · iteration 1")).toBeInTheDocument();
    expect(screen.getByText("review · iteration 2")).toBeInTheDocument();
  });

  it("shows the stored stream after clicking Raw and formats again after clicking Formatted", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(turnsResponse(sampleTurns(), "succeeded")),
    );

    render(<TaskLogs taskId="t1" initialStatus="succeeded" />);
    await settle();

    fireEvent.click(screen.getByRole("button", { name: "Raw" }));
    expect(screen.getByText(/estimated_tokens/)).toBeInTheDocument();
    expect(
      screen.queryByText(/^→ Bash: gh pr view 871/),
    ).not.toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "Formatted" }));
    expect(screen.getByText(/^→ Bash: gh pr view 871/)).toBeInTheDocument();
  });

  it("hides the format toggle until turns arrive", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(turnsResponse([], "queued")),
    );

    render(<TaskLogs taskId="t1" initialStatus="queued" />);
    await settle();

    expect(
      screen.queryByRole("button", { name: "Raw" }),
    ).not.toBeInTheDocument();
  });

  it("issues exactly one mount fetch even when the response changes status", async () => {
    // Regression guard carried over from the offset viewer: the mount fetch
    // must not re-fire when the response settles new state. Rendered without
    // the provider: the inert context guarantees zero refresh ticks, so the
    // assertion isolates the mount effect completely.
    const fetchMock = vi
      .fn()
      .mockResolvedValue(turnsResponse([turnRow(ASSISTANT_TEXT)], "running"));

    vi.stubGlobal("fetch", fetchMock);

    render(<TaskLogs taskId="t1" initialStatus="queued" />);
    await settle();

    // status queued→running and the turn append both settled; still a single fetch.
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(fetchMock).toHaveBeenCalledWith(
      `/api/tasks/t1/logs?limit=${TURNS_PAGE_LIMIT}`,
      expect.objectContaining({ signal: expect.anything() }),
    );
  });
});
