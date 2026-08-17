// @vitest-environment jsdom
import { describe, it, expect, vi, afterEach } from "vitest";
import { render, screen, act, waitFor } from "@testing-library/react";
import PRStatusPanel from "./PRStatusPanel";
import TaskRefreshProvider from "./TaskRefreshProvider";

// Icon pulls in ThemeProvider via useTheme(); stub it out — this test is about
// the polling, not the icons (those are covered by PRStatusCard's own test).
vi.mock("@/components/Icon", () => ({
  default: ({ name }: { name: string }) => <i data-testid={`icon-${name}`} />,
}));

function detailsPayload(over: Record<string, unknown> = {}) {
  return {
    number: 42,
    title: "Add the widget",
    state: "open",
    draft: false,
    merged: false,
    mergeable: true,
    html_url: "https://github.com/acme/repo/pull/42",
    checks: [],
    reviews: [],
    computed_status: "open",
    ...over,
  };
}

function stubFetchJson(payload: unknown) {
  const fetchMock = vi.fn().mockResolvedValue({
    ok: true,
    json: async () => payload,
    text: async () => JSON.stringify(payload),
  });

  vi.stubGlobal("fetch", fetchMock);

  return fetchMock;
}

async function renderSettled(props: { taskId: string; prUrl: string }) {
  let view: ReturnType<typeof render>;

  await act(async () => {
    view = render(<PRStatusPanel {...props} />);
  });
  await act(async () => {
    await Promise.resolve();
  });

  return view!;
}

// The coordinated interval now lives in TaskRefreshProvider, so timer-driven
// tests render inside it (taskStatus "done" keeps run discovery off; jsdom has
// no EventSource, so the provider stays in poll mode).
async function renderSettledWithRefresh(props: {
  taskId: string;
  prUrl: string;
}) {
  let view: ReturnType<typeof render>;

  await act(async () => {
    view = render(
      <TaskRefreshProvider taskId={props.taskId} taskStatus="done" runs={[]}>
        <PRStatusPanel {...props} />
      </TaskRefreshProvider>,
    );
  });
  await act(async () => {
    await Promise.resolve();
  });

  return view!;
}

afterEach(() => {
  vi.useRealTimers();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

describe("PRStatusPanel", () => {
  it("requests pr-status for the given task id and renders the resolved card", async () => {
    const fetchMock = stubFetchJson(
      detailsPayload({ number: 7, title: "My PR" }),
    );

    await renderSettled({ taskId: "abc-123", prUrl: "https://gh/pr/1" });
    expect(fetchMock).toHaveBeenCalledWith(
      "/api/tasks/abc-123/pr-status",
      expect.objectContaining({ signal: expect.anything() }),
    );
    expect(screen.getByText("#7 My PR")).toBeInTheDocument();
  });

  it("surfaces the unavailable fallback when the payload carries an error field", async () => {
    stubFetchJson({ error: "PR not found" });
    await renderSettled({
      taskId: "task-1",
      prUrl: "https://example.com/pr/9",
    });

    expect(screen.getByText(/Status unavailable/)).toBeInTheDocument();
    expect(
      screen.getByRole("link", { name: "View on GitHub" }),
    ).toHaveAttribute("href", "https://example.com/pr/9");
  });

  it("surfaces the unavailable fallback when the fetch rejects", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockRejectedValue(new Error("network down")),
    );

    await renderSettled({
      taskId: "task-1",
      prUrl: "https://example.com/pr/9",
    });

    await waitFor(() =>
      expect(screen.getByText(/Status unavailable/)).toBeInTheDocument(),
    );
  });

  it("does not fetch again after unmount", async () => {
    const fetchMock = stubFetchJson(detailsPayload());
    const { unmount } = await renderSettled({
      taskId: "task-1",
      prUrl: "https://gh/pr/1",
    });

    expect(fetchMock).toHaveBeenCalledTimes(1);

    unmount();
    await act(async () => {
      await Promise.resolve();
    });
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it("refetches when the task id prop changes", async () => {
    const fetchMock = stubFetchJson(detailsPayload());
    const { rerender } = await renderSettled({
      taskId: "first",
      prUrl: "https://gh/pr/1",
    });

    expect(fetchMock).toHaveBeenNthCalledWith(
      1,
      "/api/tasks/first/pr-status",
      expect.objectContaining({ signal: expect.anything() }),
    );

    await act(async () => {
      rerender(<PRStatusPanel taskId="second" prUrl="https://gh/pr/1" />);
    });
    await act(async () => {
      await Promise.resolve();
    });
    expect(fetchMock).toHaveBeenNthCalledWith(
      2,
      "/api/tasks/second/pr-status",
      expect.objectContaining({ signal: expect.anything() }),
    );
  });

  it("keeps the loaded details on screen when a later poll fails", async () => {
    vi.useFakeTimers();
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce({ ok: true, json: async () => detailsPayload() })
      .mockResolvedValue({
        ok: true,
        json: async () => ({ error: "rate limited" }),
      });

    vi.stubGlobal("fetch", fetchMock);

    await renderSettledWithRefresh({
      taskId: "task-1",
      prUrl: "https://gh/pr/1",
    });
    expect(screen.getByText("#42 Add the widget")).toBeInTheDocument();

    await act(async () => {
      vi.advanceTimersByTime(10_000);
      await Promise.resolve();
    });

    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(screen.getByText("#42 Add the widget")).toBeInTheDocument();
    expect(screen.queryByText(/Status unavailable/)).not.toBeInTheDocument();
  });

  it("stops polling once a poll fails instead of refetching forever", async () => {
    vi.useFakeTimers();
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce({ ok: true, json: async () => detailsPayload() })
      .mockResolvedValue({ ok: true, json: async () => ({ error: "gone" }) });

    vi.stubGlobal("fetch", fetchMock);

    await renderSettledWithRefresh({
      taskId: "task-1",
      prUrl: "https://gh/pr/1",
    });
    expect(fetchMock).toHaveBeenCalledTimes(1);

    await act(async () => {
      vi.advanceTimersByTime(10_000);
      await Promise.resolve();
    });
    expect(fetchMock).toHaveBeenCalledTimes(2);

    await act(async () => {
      vi.advanceTimersByTime(60_000);
      await Promise.resolve();
    });
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });
});
