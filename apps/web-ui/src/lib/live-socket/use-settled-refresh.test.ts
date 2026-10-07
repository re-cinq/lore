// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { renderHook, act } from "@testing-library/react";
import { useSettledRefresh } from "./use-settled-refresh";

const refresh = vi.fn();

vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh }) }));

beforeEach(() => {
  vi.useFakeTimers();
  refresh.mockClear();
});

afterEach(() => vi.useRealTimers());

describe("useSettledRefresh", () => {
  it("collapses two calls inside the window into one refresh", () => {
    const { result } = renderHook(() => useSettledRefresh(300));

    act(() => {
      result.current();
      result.current();
      vi.advanceTimersByTime(300);
    });

    expect(refresh).toHaveBeenCalledTimes(1);
  });

  it("refreshes nothing before the window elapses", () => {
    const { result } = renderHook(() => useSettledRefresh(300));

    act(() => {
      result.current();
      vi.advanceTimersByTime(299);
    });

    expect(refresh).not.toHaveBeenCalled();
  });
});
