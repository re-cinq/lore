// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, act } from "@testing-library/react";

// Isolate from the real Icon, which pulls in ThemeProvider/iconify.
vi.mock("@/components/Icon", () => ({
  __esModule: true,
  default: ({ name, size }: { name: string; size?: number }) => (
    <span data-testid="icon" data-icon={name} data-size={size} />
  ),
}));

import TimelinePanel from "./TimelinePanel";

function jsonResponse(payload: unknown, status = 200) {
  return {
    ok: status >= 200 && status < 300,
    status,
    json: async () => payload,
    text: async () => JSON.stringify(payload),
  };
}

function baseResponse(overrides: Record<string, unknown> = {}) {
  return {
    task_id: "t1",
    branch_name: "lore/feature",
    repo: "re-cinq/lore",
    pr_number: null,
    pr_url: null,
    pr_state: null,
    commits: [],
    current_stage: null,
    ...overrides,
  };
}

function commit(overrides: Record<string, unknown> = {}) {
  return {
    sha: "abcdef1234567890",
    stage: "implement",
    iteration: 0,
    outcome: "success",
    committed_at: "2026-06-04T10:00:00Z",
    duration_ms: 1500,
    summary: "did the thing",
    ...overrides,
  };
}

// Flush the pending fetch().then() microtask chain inside React act().
async function flush() {
  await act(async () => {
    await Promise.resolve();
    await Promise.resolve();
  });
}

beforeEach(() => {
  vi.useFakeTimers();
});

afterEach(() => {
  vi.useRealTimers();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

describe("TimelinePanel", () => {
  it("renders the loading state before the first fetch resolves", async () => {
    let resolveFetch: (v: unknown) => void = () => {};

    vi.stubGlobal(
      "fetch",
      vi.fn(
        () =>
          new Promise((res) => {
            resolveFetch = res;
          }),
      ),
    );
    render(<TimelinePanel taskId="t1" initialStatus="done" />);

    expect(screen.getByText("Loading timeline…")).toBeInTheDocument();

    await act(async () => {
      resolveFetch(jsonResponse(baseResponse()));
    });
  });

  it("requests the timeline endpoint for the given task id", async () => {
    const fetchMock = vi.fn().mockResolvedValue(jsonResponse(baseResponse()));

    vi.stubGlobal("fetch", fetchMock);
    render(<TimelinePanel taskId="task-42" initialStatus="done" />);
    await flush();

    expect(fetchMock).toHaveBeenCalledWith("/api/tasks/task-42/timeline");
  });

  it("renders the error state when the response is not ok", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(jsonResponse({}, 503)));
    render(<TimelinePanel taskId="t1" initialStatus="done" />);
    await flush();

    expect(
      screen.getByText("Timeline unavailable: HTTP 503"),
    ).toBeInTheDocument();
  });

  it("renders the error state when fetch rejects", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockRejectedValue(new Error("network down")),
    );
    render(<TimelinePanel taskId="t1" initialStatus="done" />);
    await flush();

    expect(
      screen.getByText("Timeline unavailable: network down"),
    ).toBeInTheDocument();
  });

  it("renders the resolved timeline once the fetch settles", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(jsonResponse(baseResponse())),
    );
    render(<TimelinePanel taskId="t1" initialStatus="done" />);
    await flush();

    expect(screen.getByText("Stage Timeline")).toBeInTheDocument();
    expect(screen.getByText("No stage commits yet.")).toBeInTheDocument();
  });

  it("does not install a poll interval for a terminal status with a retrospective stage", async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValue(
        jsonResponse(baseResponse({ current_stage: "retrospective" })),
      );

    vi.stubGlobal("fetch", fetchMock);
    render(<TimelinePanel taskId="t1" initialStatus="done" />);
    await flush();

    const settled = fetchMock.mock.calls.length;

    await act(async () => {
      vi.advanceTimersByTime(10_000 * 3);
    });
    await flush();
    expect(fetchMock.mock.calls.length).toBe(settled);
  });

  it("polls on the 10s interval while initialStatus is active", async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValue(
        jsonResponse(baseResponse({ current_stage: "implement" })),
      );

    vi.stubGlobal("fetch", fetchMock);
    render(<TimelinePanel taskId="t1" initialStatus="running" />);
    await flush();

    const settled = fetchMock.mock.calls.length;

    await act(async () => {
      vi.advanceTimersByTime(10_000);
    });
    await flush();
    expect(fetchMock.mock.calls.length).toBe(settled + 1);
    await act(async () => {
      vi.advanceTimersByTime(10_000);
    });
    await flush();
    expect(fetchMock.mock.calls.length).toBe(settled + 2);
  });

  it("starts polling when the current stage is active even if initialStatus is terminal", async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValue(
        jsonResponse(baseResponse({ current_stage: "validate" })),
      );

    vi.stubGlobal("fetch", fetchMock);
    render(<TimelinePanel taskId="t1" initialStatus="done" />);
    await flush();

    await act(async () => {
      vi.advanceTimersByTime(10_000);
    });
    await flush();
    expect(fetchMock.mock.calls.length).toBeGreaterThanOrEqual(2);
  });

  it("stops fetching after unmount (interval cleared)", async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValue(
        jsonResponse(baseResponse({ current_stage: "implement" })),
      );

    vi.stubGlobal("fetch", fetchMock);
    const { unmount } = render(
      <TimelinePanel taskId="t1" initialStatus="running" />,
    );

    await flush();

    const callsAtUnmount = fetchMock.mock.calls.length;

    unmount();
    await act(async () => {
      vi.advanceTimersByTime(10_000 * 5);
    });
    expect(fetchMock.mock.calls.length).toBe(callsAtUnmount);
  });

  it("clears a prior error after a subsequent successful poll", async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(jsonResponse({}, 500))
      .mockResolvedValue(
        jsonResponse(
          baseResponse({ current_stage: "implement", commits: [commit()] }),
        ),
      );

    vi.stubGlobal("fetch", fetchMock);
    render(<TimelinePanel taskId="t1" initialStatus="running" />);
    await flush();

    expect(
      screen.getByText("Timeline unavailable: HTTP 500"),
    ).toBeInTheDocument();

    await act(async () => {
      vi.advanceTimersByTime(10_000);
    });
    await flush();
    expect(screen.getByText("Stage Timeline")).toBeInTheDocument();
    expect(screen.queryByText(/Timeline unavailable/)).not.toBeInTheDocument();
  });
});
