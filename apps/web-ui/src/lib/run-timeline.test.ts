import { describe, it, expect } from "vitest";
import { timeToFraction, timelineBounds, eventTone } from "./run-timeline";
import type { TimelineEntry } from "./run-event-reducer";

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

describe("timeToFraction", () => {
  it("maps the start timestamp to 0 and the end to 1", () => {
    expect(timeToFraction(START, START, END)).toBe(0);
    expect(timeToFraction(END, START, END)).toBe(1);
  });

  it("maps a mid-point timestamp to its fraction", () => {
    expect(timeToFraction(MID, START, END)).toBe(0.5);
  });

  it("clamps a timestamp before the start to 0", () => {
    expect(timeToFraction("2026-07-20T09:00:00.000Z", START, END)).toBe(0);
  });

  it("clamps a timestamp after the end to 1", () => {
    expect(timeToFraction("2026-07-20T11:00:00.000Z", START, END)).toBe(1);
  });

  it("returns 0 when start equals end", () => {
    expect(timeToFraction(START, START, START)).toBe(0);
  });
});

describe("timelineBounds", () => {
  it("uses runStartedAt as the start and now as the end", () => {
    expect(timelineBounds([tick()], START, END)).toEqual({
      start: START,
      end: END,
    });
  });

  it("falls back to the earliest tick when runStartedAt is null", () => {
    const bounds = timelineBounds(
      [tick({ id: "2", createdAt: END }), tick({ id: "1", createdAt: MID })],
      null,
      END,
    );

    expect(bounds).toEqual({ start: MID, end: END });
  });

  it("handles zero ticks with a null start by pinning both bounds to now", () => {
    expect(timelineBounds([], null, END)).toEqual({ start: END, end: END });
  });
});

describe("eventTone", () => {
  it.each([
    ["init", "start"],
    ["result", "finish"],
    ["message", "neutral"],
    ["thinking", "neutral"],
    ["tool_call", "neutral"],
    ["tool_result", "neutral"],
  ] as const)("maps %s to the %s tone", (eventType, tone) => {
    expect(eventTone(eventType)).toBe(tone);
  });
});
