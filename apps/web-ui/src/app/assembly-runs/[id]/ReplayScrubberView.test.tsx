// @vitest-environment jsdom
import { describe, it, expect, vi } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import ReplayScrubberView from "./ReplayScrubberView";

function renderScrubber(
  over: Partial<Parameters<typeof ReplayScrubberView>[0]> = {},
) {
  const onCursorChange = vi.fn();
  const rendered = render(
    <ReplayScrubberView
      eventCount={10}
      cursor={5}
      label="event 5 / 10"
      timestamp="2026-07-20T10:05:00.000Z"
      onCursorChange={onCursorChange}
      {...over}
    />,
  );

  return { onCursorChange, slider: screen.getByRole("slider"), ...rendered };
}

describe("ReplayScrubberView", () => {
  it("renders a slider whose max is the event count", () => {
    const { slider } = renderScrubber({ eventCount: 42 });

    expect(slider).toHaveAttribute("max", "42");
    expect(slider).toHaveAttribute("min", "0");
  });

  it("reflects the current cursor as the slider value", () => {
    const { slider } = renderScrubber({ cursor: 7 });

    expect(slider).toHaveValue("7");
  });

  it("advances the cursor by one on arrow right", () => {
    const { slider, onCursorChange } = renderScrubber({ cursor: 5 });

    fireEvent.keyDown(slider, { key: "ArrowRight" });

    expect(onCursorChange).toHaveBeenCalledWith(6);
  });

  it("retreats the cursor by one on arrow left", () => {
    const { slider, onCursorChange } = renderScrubber({ cursor: 5 });

    fireEvent.keyDown(slider, { key: "ArrowLeft" });

    expect(onCursorChange).toHaveBeenCalledWith(4);
  });

  it("jumps to the first event on home and to the latest on end", () => {
    const { slider, onCursorChange } = renderScrubber({
      cursor: 5,
      eventCount: 10,
    });

    fireEvent.keyDown(slider, { key: "Home" });
    fireEvent.keyDown(slider, { key: "End" });

    expect(onCursorChange).toHaveBeenNthCalledWith(1, 0);
    expect(onCursorChange).toHaveBeenNthCalledWith(2, 10);
  });

  it("ignores keys other than the step and jump keys", () => {
    const { slider, onCursorChange } = renderScrubber();

    fireEvent.keyDown(slider, { key: "a" });

    expect(onCursorChange).not.toHaveBeenCalled();
  });

  it("clamps the cursor at the event count on arrow right at the end", () => {
    const { slider, onCursorChange } = renderScrubber({
      cursor: 10,
      eventCount: 10,
    });

    fireEvent.keyDown(slider, { key: "ArrowRight" });

    expect(onCursorChange).toHaveBeenCalledWith(10);
  });

  it("clamps the cursor at zero on arrow left at the start", () => {
    const { slider, onCursorChange } = renderScrubber({
      cursor: 0,
      eventCount: 10,
    });

    fireEvent.keyDown(slider, { key: "ArrowLeft" });

    expect(onCursorChange).toHaveBeenCalledWith(0);
  });

  it("reports the dragged slider value as the new cursor", () => {
    const { slider, onCursorChange } = renderScrubber();

    fireEvent.change(slider, { target: { value: "3" } });

    expect(onCursorChange).toHaveBeenCalledWith(3);
  });

  it("shows the position as a time not just an index", () => {
    renderScrubber({
      label: "event 5 / 10",
      timestamp: "2026-07-20T10:05:00.000Z",
    });

    expect(screen.getByText("event 5 / 10")).toBeInTheDocument();
    expect(
      screen.getByText((_, node) => node?.tagName === "TIME"),
    ).toHaveAttribute("dateTime", "2026-07-20T10:05:00.000Z");
  });

  it("omits the time element when no event has applied yet", () => {
    const { container } = renderScrubber({
      cursor: 0,
      label: "event 0 / 10",
      timestamp: null,
    });

    expect(container.querySelector("time")).toBeNull();
  });
});
