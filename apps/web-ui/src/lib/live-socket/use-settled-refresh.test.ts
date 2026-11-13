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
  it("refreshes at once on the first call", () => {
    const { result } = renderHook(() => useSettledRefresh(10_000));

    act(() => result.current());

    expect(refresh).toHaveBeenCalledTimes(1);
  });

  it("refreshes twice for calls at 0 s, 1 s and 2 s: at once and once more at 10 s", () => {
    const { result } = renderHook(() => useSettledRefresh(10_000));

    act(() => {
      result.current();
      vi.advanceTimersByTime(1_000);
      result.current();
      vi.advanceTimersByTime(1_000);
      result.current();
      vi.advanceTimersByTime(7_999);
    });
    expect(refresh).toHaveBeenCalledTimes(1);

    act(() => vi.advanceTimersByTime(1));
    expect(refresh).toHaveBeenCalledTimes(2);
  });

  it("refreshes at once again for a call 10 s after a quiet one", () => {
    const { result } = renderHook(() => useSettledRefresh(10_000));

    act(() => {
      result.current();
      vi.advanceTimersByTime(10_000);
      result.current();
    });

    expect(refresh).toHaveBeenCalledTimes(2);
  });
});
