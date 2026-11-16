// @vitest-environment jsdom
import { describe, it, expect, vi, afterEach } from "vitest";
import { act, render, screen } from "@testing-library/react";
import { useScrolledPast } from "./use-scrolled-past";

function Probe() {
  const { sentinelRef, scrolled } = useScrolledPast<HTMLDivElement>();

  return (
    <>
      <div ref={sentinelRef} />
      <output>{scrolled ? "scrolled" : "at the top"}</output>
    </>
  );
}

afterEach(() => vi.unstubAllGlobals());

describe("useScrolledPast", () => {
  it("reads the bar as scrolled once the sentinel leaves the view", () => {
    let report: (entries: { isIntersecting: boolean }[]) => void = () => {};

    vi.stubGlobal(
      "IntersectionObserver",
      class {
        constructor(callback: typeof report) {
          report = callback;
        }
        observe() {}
        disconnect() {}
      },
    );
    render(<Probe />);
    const before = screen.getByRole("status").textContent;

    act(() => report([{ isIntersecting: false }]));

    expect({ before, after: screen.getByRole("status").textContent }).toEqual({
      before: "at the top",
      after: "scrolled",
    });
  });

  it("reads it as not scrolled without IntersectionObserver", () => {
    vi.stubGlobal("IntersectionObserver", undefined);
    render(<Probe />);

    expect(screen.getByRole("status").textContent).toBe("at the top");
  });
});
