import { describe, expect, it } from "vitest";
import type { AgentRunEvent } from "@re-cinq/lore-shared/models/agent-run-event.js";
import { eventPage } from "./run-events.js";

function event(id: string): AgentRunEvent {
  return {
    id,
    taskId: "run-1",
    agentCrName: "floor-visit-1",
    assemblyLineId: "run-1",
    stationRunId: "visit-1",
    nodeId: "review",
    iteration: 1,
    eventType: "message",
    toolName: null,
    toolUseId: null,
    isError: false,
    filePaths: [],
    summary: null,
    payload: {},
    createdAt: new Date("2026-09-30T08:00:00.000Z"),
  };
}

const THREE_EVENTS = [event("100"), event("101"), event("200")];

function ids(page: { events: AgentRunEvent[] }): string[] {
  return page.events.map((row) => row.id);
}

describe("eventPage", () => {
  it("answers every event when no cursor or limit is given", () => {
    expect(ids(eventPage(THREE_EVENTS, {}))).toEqual(["100", "101", "200"]);
  });

  it("answers events 101 and 200 after cursor 100", () => {
    expect(ids(eventPage(THREE_EVENTS, { after: "100" }))).toEqual([
      "101",
      "200",
    ]);
  });

  it("compares a cursor past the safe integer range as a bigint", () => {
    const far = event("9007199254740993");

    expect(ids(eventPage([far], { after: "9007199254740992" }))).toEqual([
      far.id,
    ]);
  });

  it("ends the page after the whole turn the limit landed in: 100 and 101 at limit 1, not 100 alone", () => {
    expect(ids(eventPage(THREE_EVENTS, { limit: "1" }))).toEqual([
      "100",
      "101",
    ]);
  });

  it("answers every event for a limit of -5, which is no page size", () => {
    expect(ids(eventPage(THREE_EVENTS, { limit: "-5" }))).toEqual([
      "100",
      "101",
      "200",
    ]);
  });

  it("answers every event for a cursor that is no number, rather than failing", () => {
    expect(ids(eventPage(THREE_EVENTS, { after: "abc" }))).toEqual([
      "100",
      "101",
      "200",
    ]);
  });

  it("answers an empty page for a run with no events", () => {
    expect(eventPage([], { after: "5" })).toEqual({ events: [] });
  });
});
