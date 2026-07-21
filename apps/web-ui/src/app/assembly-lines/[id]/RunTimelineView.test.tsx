// @vitest-environment jsdom
import { describe, it, expect, vi } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import RunTimelineView from "./RunTimelineView";
import type { TimelineEntry } from "@/lib/run-event-reducer";

const START = "2026-07-20T10:00:00.000Z";
const MID = "2026-07-20T10:05:00.000Z";
const END = "2026-07-20T10:10:00.000Z";

const tick = (over: Partial<TimelineEntry> = {}): TimelineEntry => ({
  id: "1",
  nodeId: "implement",
  iteration: 1,
  eventType: "init",
  createdAt: MID,
  ...over,
});

const ticksOf = (container: HTMLElement) =>
  Array.from(container.querySelectorAll<HTMLElement>("[data-tone]"));

describe("RunTimelineView", () => {
  it("positions a tick by its wall-clock fraction between start and now", () => {
    const { container } = render(
      <RunTimelineView ticks={[tick()]} runStartedAt={START} now={END} />,
    );

    expect(ticksOf(container)[0].style.left).toBe("50%");
  });

  it("leaves a visible gap to the now edge for a node still running", () => {
    const { container } = render(
      <RunTimelineView
        ticks={[tick({ createdAt: START })]}
        runStartedAt={START}
        now={END}
      />,
    );

    expect(ticksOf(container)[0].style.left).toBe("0%");
  });

  it("colors each tick by its event type", () => {
    const { container } = render(
      <RunTimelineView
        ticks={[
          tick({ id: "1", eventType: "init", createdAt: START }),
          tick({ id: "2", eventType: "result", createdAt: END }),
        ]}
        runStartedAt={START}
        now={END}
      />,
    );

    const tones = ticksOf(container).map((el) => el.getAttribute("data-tone"));

    expect(tones).toEqual(["start", "finish"]);
  });

  it("names the node and event type in each tick title", () => {
    render(<RunTimelineView ticks={[tick()]} runStartedAt={START} now={END} />);

    expect(screen.getByTitle("implement init")).toBeInTheDocument();
  });

  it("calls onSeek with the tick id when activated", () => {
    const onSeek = vi.fn();

    render(
      <RunTimelineView
        ticks={[tick({ id: "42" })]}
        runStartedAt={START}
        now={END}
        onSeek={onSeek}
      />,
    );

    fireEvent.click(screen.getByRole("button"));

    expect(onSeek).toHaveBeenCalledWith("42");
  });

  it("renders an empty state for a run with no timeline activity", () => {
    render(<RunTimelineView ticks={[]} runStartedAt={null} now={END} />);

    expect(screen.getByText("No timeline activity yet.")).toBeInTheDocument();
  });
});
