// @vitest-environment jsdom
import { describe, it, expect, beforeEach } from "vitest";
import { act, renderHook } from "@testing-library/react";
import { useResizablePanelWidth } from "./use-resizable-panel-width";

const KEY = "run-inspector-width";

beforeEach(() => {
  window.localStorage.clear();
});

describe("useResizablePanelWidth", () => {
  it("starts at the 380 default when nothing is stored", () => {
    const { result } = renderHook(() => useResizablePanelWidth());

    expect(result.current.width).toBe(380);
  });

  it("restores a stored 500 after mount", () => {
    window.localStorage.setItem(KEY, "500");
    const { result } = renderHook(() => useResizablePanelWidth());

    expect(result.current.width).toBe(500);
  });

  it("clamps a set 900 to 720 and stores it", () => {
    const { result } = renderHook(() => useResizablePanelWidth());

    act(() => result.current.setWidth(900));

    expect(result.current.width).toBe(720);
    expect(window.localStorage.getItem(KEY)).toBe("720");
  });
});
