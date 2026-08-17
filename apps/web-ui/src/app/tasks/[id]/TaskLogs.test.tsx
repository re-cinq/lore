// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, act, fireEvent } from "@testing-library/react";
import TaskLogs from "./TaskLogs";
import TaskRefreshProvider from "./TaskRefreshProvider";
import { SAMPLE_LOG, TOOL_USE_BASH } from "@/lib/agent-log-entries.fixtures";

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

// jsdom does not implement scrollIntoView; the auto-scroll effect calls it on every logs change.
beforeEach(() => {
  Element.prototype.scrollIntoView = vi.fn();
});

afterEach(() => {
  vi.useRealTimers();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

type Payload = {
  logs: string | null;
  status: string;
  totalSize: number;
  error?: string;
};

function jsonResponse(
  body: Payload,
  init: { ok?: boolean; status?: number } = {},
) {
  return {
    ok: init.ok ?? true,
    status: init.status ?? 200,
    json: async () => body,
    text: async () => JSON.stringify(body),
  };
}

// Flush the pending fetch().then() microtask chain so the state setters run inside act().
// Several `.then` hops chain (fetch -> res -> res.json -> setState), so loop until quiet.
async function settle() {
  for (let i = 0; i < 8; i++) {
    await act(async () => {
      await Promise.resolve();
    });
  }
}

function offsetCalls(fetchMock: ReturnType<typeof vi.fn>): string[] {
  return fetchMock.mock.calls
    .map((c) => c[0] as string)
    .filter((u) => u.includes("offset="));
}

describe("TaskLogs", () => {
  it("renders the empty placeholder before any logs resolve", async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValue(
        jsonResponse({ logs: null, status: "queued", totalSize: 0 }),
      );

    vi.stubGlobal("fetch", fetchMock);

    render(<TaskLogs taskId="t1" initialStatus="queued" />);
    expect(
      screen.getByText("Logs will appear when the agent starts."),
    ).toBeInTheDocument();

    await settle();
    // Server returned null logs → placeholder remains, terminal block absent.
    expect(
      screen.getByText("Logs will appear when the agent starts."),
    ).toBeInTheDocument();
  });

  it("requests the bare logs URL (no offset) on the initial full fetch", async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValue(
        jsonResponse({ logs: "line-1\n", status: "succeeded", totalSize: 7 }),
      );

    vi.stubGlobal("fetch", fetchMock);

    render(<TaskLogs taskId="abc" initialStatus="succeeded" />);
    await settle();

    expect(fetchMock).toHaveBeenCalledWith("/api/tasks/abc/logs", expect.objectContaining({ signal: expect.anything() }));
    // succeeded is not an ACTIVE_STATE → the offset branch is never taken.
    expect(offsetCalls(fetchMock)).toHaveLength(0);
  });

  it("renders fetched logs in the terminal block after the first resolved fetch", async () => {
    const fetchMock = vi.fn().mockResolvedValue(
      jsonResponse({
        logs: "hello world output",
        status: "succeeded",
        totalSize: 18,
      }),
    );

    vi.stubGlobal("fetch", fetchMock);

    render(<TaskLogs taskId="t1" initialStatus="queued" />);
    await settle();

    expect(screen.getByText("hello world output")).toBeInTheDocument();
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
          jsonResponse({ logs: "x", status: "succeeded", totalSize: 1 }),
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
          jsonResponse({ logs: "x", status: "pr-created", totalSize: 1 }),
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
        .mockResolvedValue(
          jsonResponse({ logs: "x", status: "merged", totalSize: 1 }),
        ),
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
        .mockResolvedValue(
          jsonResponse({ logs: "x", status: "review", totalSize: 1 }),
        ),
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
        .mockResolvedValue(
          jsonResponse({ logs: "x", status: "failed", totalSize: 1 }),
        ),
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
          jsonResponse({ logs: "x", status: "cancelled", totalSize: 1 }),
        ),
    );
    render(<TaskLogs taskId="t1" initialStatus="cancelled" />);
    await settle();
    expect(screen.getByText("Failed")).toBeInTheDocument();
  });

  it("renders the pulse indicator and KB polling note while running", async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValue(
        jsonResponse({ logs: "x", status: "running", totalSize: 2048 }),
      );

    vi.stubGlobal("fetch", fetchMock);

    const { container } = render(
      <TaskLogs taskId="t1" initialStatus="running" />,
    );

    await settle();

    expect(container.querySelector('span[class*="pulse"]')).not.toBeNull();
    // 2048 bytes / 1024 = 2.0 KB received.
    expect(
      screen.getByText(/Auto-refreshing — 2\.0 KB received/),
    ).toBeInTheDocument();
  });

  it("shows the bare refresh note when running with zero bytes received", async () => {
    vi.stubGlobal(
      "fetch",
      vi
        .fn()
        .mockResolvedValue(
          jsonResponse({ logs: null, status: "running", totalSize: 0 }),
        ),
    );
    render(<TaskLogs taskId="t1" initialStatus="running" />);
    await settle();

    const note = screen.getByText("Auto-refreshing");

    expect(note.textContent).toBe("Auto-refreshing");
  });

  it("appends new content using the offset URL once totalSize is known and status is running", async () => {
    // Converging buffer server: a full log of 18 bytes ("first-chunk-second").
    // Bare URL -> the head (first 11 bytes) so the next poll uses ?offset=11.
    // ?offset=11 -> the 7-byte tail, which the component appends.
    // ?offset=18 (after append) -> empty tail, no further growth → fixed point, no oscillation.
    const FULL = "first-chunk-second";
    const fetchMock = vi.fn().mockImplementation((url: string) => {
      const m = url.match(/offset=(\d+)/);

      if (!m) {
        return Promise.resolve(
          jsonResponse({
            logs: FULL.slice(0, 11),
            status: "running",
            totalSize: 11,
          }),
        );
      }
      const off = Number(m[1]);

      return Promise.resolve(
        jsonResponse({
          logs: FULL.slice(off),
          status: "running",
          totalSize: FULL.length,
        }),
      );
    });

    vi.useFakeTimers();
    vi.stubGlobal("fetch", fetchMock);

    renderWithRefresh(<TaskLogs taskId="job9" initialStatus="running" />);
    await settle();

    // The coordinator's poll fires the offset fetch (totalSize 11 + running), which appends.
    await act(async () => {
      vi.advanceTimersByTime(10_000);
    });
    await settle();

    expect(offsetCalls(fetchMock)).toContain("/api/tasks/job9/logs?offset=11");
    expect(screen.getByText("first-chunk-second")).toBeInTheDocument();
  });

  it("does not append when an offset poll returns an empty logs string", async () => {
    const fetchMock = vi.fn().mockImplementation((url: string) => {
      if (url.includes("offset=")) {
        return Promise.resolve(
          jsonResponse({ logs: "", status: "running", totalSize: 10 }),
        );
      }

      return Promise.resolve(
        jsonResponse({ logs: "only-chunk", status: "running", totalSize: 10 }),
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

    expect(offsetCalls(fetchMock).length).toBeGreaterThan(0);
    // The empty offset delta must not be appended (and must not blank the head chunk).
    expect(screen.getByText("only-chunk")).toBeInTheDocument();
  });

  it("appends onto a still-null log buffer when the first fetch reports size but no body", async () => {
    // Initial fetch: totalSize>0 but logs===null (e.g. a counted-but-not-yet-flushed buffer),
    // so `logs` state stays null while totalSize becomes >0. The next poll uses ?offset and
    // returns a body, exercising the `(prev ?? "") + data.logs` null-prev branch on line 84.
    // Server buffer: 5 already-counted bytes (never flushed to body) + "late-body".
    const HEAD = 5;
    const BODY = "late-body";
    const TOTAL = HEAD + BODY.length;
    const fetchMock = vi.fn().mockImplementation((url: string) => {
      const m = url.match(/offset=(\d+)/);

      if (!m) {
        // Bare fetch: counted but unflushed → null body, size only.
        return Promise.resolve(
          jsonResponse({ logs: null, status: "running", totalSize: HEAD }),
        );
      }
      const off = Number(m[1]);
      // Tail beyond the offset converges to empty once the whole body is delivered.
      const tail = off >= HEAD ? BODY.slice(off - HEAD) : BODY;

      return Promise.resolve(
        jsonResponse({ logs: tail, status: "running", totalSize: TOTAL }),
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

    expect(offsetCalls(fetchMock).length).toBeGreaterThan(0);
    // prev was null → coalesced to "" → terminal shows just the appended tail.
    expect(screen.getByText("late-body")).toBeInTheDocument();
  });

  it("replaces logs on the full (non-offset) fetch path", async () => {
    const fetchMock = vi.fn().mockResolvedValue(
      jsonResponse({
        logs: "replaced-entirely",
        status: "succeeded",
        totalSize: 17,
      }),
    );

    vi.stubGlobal("fetch", fetchMock);

    render(<TaskLogs taskId="t1" initialStatus="succeeded" />);
    await settle();

    // Non-active status keeps useOffset false → the replace branch runs on the bare URL.
    expect(offsetCalls(fetchMock)).toHaveLength(0);
    expect(screen.getByText("replaced-entirely")).toBeInTheDocument();
  });

  it("renders the access-denied message and stops polling on a 403 response", async () => {
    vi.useFakeTimers();
    const fetchMock = vi
      .fn()
      .mockResolvedValue(
        jsonResponse(
          { logs: null, status: "running", totalSize: 0 },
          { ok: false, status: 403 },
        ),
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
          jsonResponse(
            { logs: null, status: "running", totalSize: 0 },
            { ok: false, status: 401 },
          ),
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
          jsonResponse(
            { logs: null, status: "failed", totalSize: 0 },
            { ok: false, status: 500 },
          ),
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
    const RECOVERED = "recovered";
    let failFirst = true;
    const fetchMock = vi.fn().mockImplementation((url: string) => {
      if (failFirst) {
        failFirst = false;

        return Promise.resolve(
          jsonResponse(
            { logs: null, status: "running", totalSize: 0 },
            { ok: false, status: 500 },
          ),
        );
      }
      // Converging buffer so the re-fired offset poll returns an empty tail (no double-append).
      const m = url.match(/offset=(\d+)/);
      const off = m ? Number(m[1]) : 0;

      return Promise.resolve(
        jsonResponse({
          logs: RECOVERED.slice(off),
          status: "running",
          totalSize: RECOVERED.length,
        }),
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
    expect(screen.getByText("recovered")).toBeInTheDocument();
  });

  it("keeps polling on the running interval and stops fetching after unmount", async () => {
    vi.useFakeTimers();
    const fetchMock = vi
      .fn()
      .mockResolvedValue(
        jsonResponse({ logs: "tick", status: "running", totalSize: 4 }),
      );

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
      .mockResolvedValue(
        jsonResponse({ logs: "final", status: "succeeded", totalSize: 5 }),
      );

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
      vi
        .fn()
        .mockResolvedValue(
          jsonResponse({ logs: null, status: "queued", totalSize: 0 }),
        ),
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
          jsonResponse({
            logs: "working...",
            status: "running",
            totalSize: 10,
          }),
        );
      }

      return Promise.resolve(
        jsonResponse({
          logs: "working...done",
          status: "pr-created",
          totalSize: 14,
        }),
      );
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

  it("renders the sample NDJSON as formatted entries by default", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(
        jsonResponse({
          logs: SAMPLE_LOG,
          status: "succeeded",
          totalSize: SAMPLE_LOG.length,
        }),
      ),
    );

    render(<TaskLogs taskId="t1" initialStatus="succeeded" />);
    await settle();

    expect(screen.getByText(/^→ Bash: gh pr view 871/)).toBeInTheDocument();
    // SAMPLE_LOG carries two thinking_tokens runs → exactly two counters.
    expect(screen.getAllByText(/^thinking… ~/)).toHaveLength(2);
    expect(
      screen.getByText("✓ finished — 3m 21s · $0.51 · 27 turns"),
    ).toBeInTheDocument();
    // The raw JSON ticker lines are gone in formatted mode.
    expect(screen.queryByText(/estimated_tokens/)).not.toBeInTheDocument();
  });

  it("shows the verbatim blob after clicking Raw and formats again after clicking Formatted", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(
        jsonResponse({
          logs: SAMPLE_LOG,
          status: "succeeded",
          totalSize: SAMPLE_LOG.length,
        }),
      ),
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

  it("classifies a JSON line split across an offset poll after the second chunk arrives", async () => {
    // Converging buffer: the head fetch delivers half a JSON line, the offset
    // poll the rest — the full-blob reparse must classify the healed line.
    const HEAD = TOOL_USE_BASH.slice(0, 40);
    const FULL = `${TOOL_USE_BASH}\n`;
    const fetchMock = vi.fn().mockImplementation((url: string) => {
      const m = url.match(/offset=(\d+)/);

      if (!m) {
        return Promise.resolve(
          jsonResponse({
            logs: HEAD,
            status: "running",
            totalSize: HEAD.length,
          }),
        );
      }

      return Promise.resolve(
        jsonResponse({
          logs: FULL.slice(Number(m[1])),
          status: "running",
          totalSize: FULL.length,
        }),
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

    expect(offsetCalls(fetchMock).length).toBeGreaterThan(0);
    expect(screen.getByText(/^→ Bash: gh pr view 871/)).toBeInTheDocument();
    // No dangling half-line rendered as raw.
    expect(screen.queryByText(HEAD)).not.toBeInTheDocument();
  });

  it("hides the format toggle until logs arrive", async () => {
    vi.stubGlobal(
      "fetch",
      vi
        .fn()
        .mockResolvedValue(
          jsonResponse({ logs: null, status: "queued", totalSize: 0 }),
        ),
    );

    render(<TaskLogs taskId="t1" initialStatus="queued" />);
    await settle();

    expect(
      screen.queryByRole("button", { name: "Raw" }),
    ).not.toBeInTheDocument();
  });

  it("issues exactly one mount fetch even when the response changes totalSize and status", async () => {
    // Regression: the mount fetch was keyed on fetchLogs identity, which changes
    // whenever totalSize/status settle — every growing response re-fired the
    // "initial" effect, doubling requests. The run-once effect must not re-fire.
    // Rendered without the provider: the inert context guarantees zero refresh
    // ticks, so the assertion isolates the mount effect completely.
    const fetchMock = vi
      .fn()
      .mockResolvedValue(
        jsonResponse({ logs: "grow", status: "running", totalSize: 4 }),
      );

    vi.stubGlobal("fetch", fetchMock);

    render(<TaskLogs taskId="t1" initialStatus="queued" />);
    await settle();

    // totalSize 0→4 and status queued→running both settled; still a single fetch.
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(fetchMock).toHaveBeenCalledWith("/api/tasks/t1/logs", expect.objectContaining({ signal: expect.anything() }));
  });
});
