// @vitest-environment jsdom
import { describe, it, expect, vi, afterEach } from "vitest";
import { render } from "@testing-library/react";
import { RunAutoRefresh, RUN_REFRESH_INTERVAL_MS } from "./RunAutoRefresh";

const refresh = vi.fn();

vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh }) }));

afterEach(() => {
  vi.useRealTimers();
  refresh.mockClear();
});

describe("RunAutoRefresh", () => {
  it("re-renders the server page on a cadence while the run is live", () => {
    vi.useFakeTimers();
    render(<RunAutoRefresh runStatus="running" />);

    vi.advanceTimersByTime(RUN_REFRESH_INTERVAL_MS * 2);

    expect(refresh).toHaveBeenCalledTimes(2);
  });

  it("refreshes nothing for a terminal run — the snapshot is the truth", () => {
    vi.useFakeTimers();
    render(<RunAutoRefresh runStatus="finished" />);
    render(<RunAutoRefresh runStatus="failed" />);

    vi.advanceTimersByTime(RUN_REFRESH_INTERVAL_MS * 3);

    expect(refresh).not.toHaveBeenCalled();
  });

  it("stops the cadence on unmount", () => {
    vi.useFakeTimers();
    const view = render(<RunAutoRefresh runStatus="queued" />);

    view.unmount();
    vi.advanceTimersByTime(RUN_REFRESH_INTERVAL_MS * 3);

    expect(refresh).not.toHaveBeenCalled();
  });
});
