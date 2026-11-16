// @vitest-environment jsdom
import { describe, it, expect, vi, afterEach } from "vitest";
import { act, render, screen } from "@testing-library/react";
import { useElementHeight } from "./use-element-height";

function Probe() {
  const { ref, height } = useElementHeight<HTMLDivElement>();

  return (
    <>
      <div ref={ref} />
      <output>{height}</output>
    </>
  );
}

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe("useElementHeight", () => {
  it("reports 64 for a bar 64px tall", () => {
    let resize: () => void = () => {};

    vi.stubGlobal(
      "ResizeObserver",
      class {
        constructor(callback: () => void) {
          resize = callback;
        }
        observe() {}
        disconnect() {}
      },
    );
    vi.spyOn(HTMLElement.prototype, "getBoundingClientRect").mockReturnValue({
      height: 64,
    } as DOMRect);
    render(<Probe />);

    act(() => resize());

    expect(screen.getByRole("status").textContent).toBe("64");
  });

  it("reports 0 without ResizeObserver", () => {
    vi.stubGlobal("ResizeObserver", undefined);
    render(<Probe />);

    expect(screen.getByRole("status").textContent).toBe("0");
  });
});
