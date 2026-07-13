// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, act, waitFor } from "@testing-library/react";
import PRStatusBadge from "./PRStatusBadge";

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

describe("PRStatusBadge", () => {
  it("renders nothing before the fetch resolves", () => {
    stubFetch(() => jsonResponse({ computed_status: "open" }));
    const { container } = render(<PRStatusBadge taskId="task-1" />);
    // Status is still null on the synchronous first paint.
    expect(container.querySelector(".status-pill")).toBeNull();
    expect(container.textContent).toBe("");
  });

  it("requests the pr-status endpoint for the given task id", async () => {
    const fetchMock = stubFetch(() =>
      jsonResponse({ computed_status: "open" }),
    );
    render(<PRStatusBadge taskId="abc-123" />);
    await flushFetch();
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(fetchMock).toHaveBeenCalledWith(
      "/api/assembly-lines/abc-123/pr-status",
    );
  });

  it("renders the status pill with the computed status text after resolve", async () => {
    stubFetch(() => jsonResponse({ computed_status: "open" }));
    render(<PRStatusBadge taskId="t" />);
    await flushFetch();
    const pill = await screen.findByText("open");
    expect(pill).toHaveClass("status-pill");
  });

  // Drive every key in STATUS_COLORS so each mapped --pill-color branch is hit.
  const knownStatuses: Array<[string, string]> = [
    ["draft", "var(--text-muted)"],
    ["open", "var(--info)"],
    ["checks-failing", "var(--danger)"],
    ["changes-requested", "var(--warning)"],
    ["approved", "var(--success)"],
    ["merged", "var(--accent)"],
    ["closed", "var(--border-hover)"],
  ];

  it.each(knownStatuses)(
    "maps the %s status to its pill color",
    async (status, color) => {
      stubFetch(() => jsonResponse({ computed_status: status }));
      render(<PRStatusBadge taskId={`task-${status}`} />);
      await flushFetch();
      const pill = await screen.findByText(status);
      expect(pill.style.getPropertyValue("--pill-color")).toBe(color);
    },
  );

  it("falls back to the muted color for an unknown status", async () => {
    stubFetch(() => jsonResponse({ computed_status: "totally-unknown" }));
    render(<PRStatusBadge taskId="weird" />);
    await flushFetch();
    const pill = await screen.findByText("totally-unknown");
    // STATUS_COLORS['totally-unknown'] is undefined → '|| var(--text-muted)' branch.
    expect(pill.style.getPropertyValue("--pill-color")).toBe(
      "var(--text-muted)",
    );
  });

  it("renders nothing when the payload has no computed_status", async () => {
    stubFetch(() => jsonResponse({ something_else: true }));
    const { container } = render(<PRStatusBadge taskId="no-status" />);
    await flushFetch();
    // data.computed_status is falsy → setStatus never called → still null.
    expect(container.querySelector(".status-pill")).toBeNull();
    expect(container.textContent).toBe("");
  });

  it("renders nothing when computed_status is an empty string", async () => {
    stubFetch(() => jsonResponse({ computed_status: "" }));
    const { container } = render(<PRStatusBadge taskId="empty" />);
    await flushFetch();
    // Empty string is falsy in the guard AND the `if (!status)` early return.
    expect(container.querySelector(".status-pill")).toBeNull();
  });

  it("renders nothing and stays silent when the fetch rejects", async () => {
    const fetchMock = vi.fn(() => Promise.reject(new Error("network down")));
    vi.stubGlobal("fetch", fetchMock);
    const { container } = render(<PRStatusBadge taskId="boom" />);
    await flushFetch();
    // .catch swallows the error; component remains null.
    expect(container.querySelector(".status-pill")).toBeNull();
    expect(container.textContent).toBe("");
  });

  it("renders nothing and stays silent when json parsing rejects", async () => {
    const fetchMock = vi.fn(() =>
      Promise.resolve({
        ok: true,
        json: async () => {
          throw new Error("bad json");
        },
      }),
    );
    vi.stubGlobal("fetch", fetchMock);
    const { container } = render(<PRStatusBadge taskId="badjson" />);
    await flushFetch();
    // The rejected json() propagates to .catch → silent.
    expect(container.querySelector(".status-pill")).toBeNull();
  });

  it("re-fetches and updates when the taskId prop changes", async () => {
    const byTask: Record<string, string> = {
      "/api/assembly-lines/first/pr-status": "open",
      "/api/assembly-lines/second/pr-status": "merged",
    };
    const fetchMock = stubFetch((url) =>
      jsonResponse({ computed_status: byTask[url] }),
    );

    const { rerender } = render(<PRStatusBadge taskId="first" />);
    await flushFetch();
    expect(await screen.findByText("open")).toBeInTheDocument();

    rerender(<PRStatusBadge taskId="second" />);
    await flushFetch();
    // Effect dependency [taskId] fires a second fetch for the new id.
    expect(await screen.findByText("merged")).toBeInTheDocument();
    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(fetchMock).toHaveBeenNthCalledWith(
      1,
      "/api/assembly-lines/first/pr-status",
    );
    expect(fetchMock).toHaveBeenNthCalledWith(
      2,
      "/api/assembly-lines/second/pr-status",
    );
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

    const { unmount, container } = render(<PRStatusBadge taskId="late" />);
    expect(fetchMock).toHaveBeenCalledTimes(1);

    unmount();
    // Resolve only after unmount: there is no interval to clear, but the late
    // setState must not crash and must not produce DOM.
    await act(async () => {
      resolveFetch(jsonResponse({ computed_status: "open" }));
      await Promise.resolve();
      await Promise.resolve();
    });
    expect(container.querySelector(".status-pill")).toBeNull();
    // No further fetches happen post-unmount.
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });
});
