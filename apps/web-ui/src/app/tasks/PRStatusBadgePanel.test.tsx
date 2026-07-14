// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, act } from "@testing-library/react";
import PRStatusBadgePanel from "./PRStatusBadgePanel";

function jsonResponse(payload: unknown) {
  return {
    ok: true,
    json: async () => payload,
    text: async () => JSON.stringify(payload),
  };
}

function stubFetch(impl: (url: string) => unknown) {
  const fetchMock = vi.fn((url: string) => Promise.resolve(impl(url)));

  vi.stubGlobal("fetch", fetchMock);

  return fetchMock as unknown as ReturnType<typeof vi.fn>;
}

// Flush the .then/.catch microtask chain hanging off the awaited fetch so the
// resulting setState lands inside an act() scope.
async function flushFetch() {
  await act(async () => {
    await Promise.resolve();
    await Promise.resolve();
  });
}

beforeEach(() => {
  vi.clearAllMocks();
});

afterEach(() => {
  vi.useRealTimers();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

describe("PRStatusBadgePanel", () => {
  it("renders nothing before the fetch resolves", () => {
    stubFetch(() => jsonResponse({ computed_status: "open" }));
    const { container } = render(<PRStatusBadgePanel taskId="task-1" />);

    expect(container.querySelector(".status-pill")).toBeNull();
    expect(container.textContent).toBe("");
  });

  it("requests the pr-status endpoint for the given task id", async () => {
    const fetchMock = stubFetch(() =>
      jsonResponse({ computed_status: "open" }),
    );

    render(<PRStatusBadgePanel taskId="abc-123" />);
    await flushFetch();
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(fetchMock).toHaveBeenCalledWith("/api/tasks/abc-123/pr-status");
  });

  it("renders the resolved status in the pill after the fetch settles", async () => {
    stubFetch(() => jsonResponse({ computed_status: "approved" }));
    render(<PRStatusBadgePanel taskId="t" />);
    await flushFetch();
    const pill = await screen.findByText("approved");

    expect(pill).toHaveClass("status-pill");
  });

  it("renders nothing when the payload has no computed_status", async () => {
    stubFetch(() => jsonResponse({ something_else: true }));
    const { container } = render(<PRStatusBadgePanel taskId="no-status" />);

    await flushFetch();
    expect(container.querySelector(".status-pill")).toBeNull();
  });

  it("renders nothing and stays silent when the fetch rejects", async () => {
    const fetchMock = vi.fn(() => Promise.reject(new Error("network down")));

    vi.stubGlobal("fetch", fetchMock);
    const { container } = render(<PRStatusBadgePanel taskId="boom" />);

    await flushFetch();
    expect(container.querySelector(".status-pill")).toBeNull();
    expect(container.textContent).toBe("");
  });

  it("re-fetches and updates when the taskId prop changes", async () => {
    const byTask: Record<string, string> = {
      "/api/tasks/first/pr-status": "open",
      "/api/tasks/second/pr-status": "merged",
    };
    const fetchMock = stubFetch((url) =>
      jsonResponse({ computed_status: byTask[url] }),
    );

    const { rerender } = render(<PRStatusBadgePanel taskId="first" />);

    await flushFetch();
    expect(await screen.findByText("open")).toBeInTheDocument();

    rerender(<PRStatusBadgePanel taskId="second" />);
    await flushFetch();
    expect(await screen.findByText("merged")).toBeInTheDocument();
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it("does not throw when the fetch resolves after unmount", async () => {
    let resolveFetch: (value: unknown) => void = () => {};
    const fetchMock = vi.fn(
      () =>
        new Promise((resolve) => {
          resolveFetch = resolve;
        }),
    );

    vi.stubGlobal("fetch", fetchMock);

    const { unmount, container } = render(<PRStatusBadgePanel taskId="late" />);

    expect(fetchMock).toHaveBeenCalledTimes(1);

    unmount();
    await act(async () => {
      resolveFetch(jsonResponse({ computed_status: "open" }));
      await Promise.resolve();
      await Promise.resolve();
    });
    expect(container.querySelector(".status-pill")).toBeNull();
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });
});
