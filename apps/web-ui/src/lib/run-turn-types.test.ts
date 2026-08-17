import { describe, it, expect } from "vitest";
import { parseAgentRunTurn } from "./run-turn-types";

const wire = {
  id: "42",
  taskId: "task-1",
  agentCrName: "05fc5491-implement",
  assemblyLineId: "line-1",
  nodeId: "implement",
  iteration: 2,
  stationRunId: "station-run-1",
  eventType: "assistant",
  envelope: {
    source: { agent: "05fc5491-implement" },
    event: { type: "assistant" },
  },
  createdAt: "2026-08-12T10:00:00.000Z",
};

describe("parseAgentRunTurn", () => {
  it("parses a fully correlated turn row", () => {
    expect(parseAgentRunTurn(wire)).toEqual(wire);
  });

  it("keeps an uncorrelated row, with every correlation field null", () => {
    const uncorrelated = {
      ...wire,
      taskId: null,
      agentCrName: null,
      assemblyLineId: null,
      nodeId: null,
      iteration: null,
      stationRunId: null,
    };

    expect(parseAgentRunTurn(uncorrelated)).toEqual(uncorrelated);
  });

  it("keeps an eventType this client has never seen, unnarrowed", () => {
    expect(
      parseAgentRunTurn({ ...wire, eventType: "brand-new-kind" }),
    ).toMatchObject({
      eventType: "brand-new-kind",
    });
  });

  it("returns null when the id is missing", () => {
    expect(parseAgentRunTurn({ ...wire, id: undefined })).toBeNull();
  });

  it("returns null when createdAt is missing", () => {
    expect(parseAgentRunTurn({ ...wire, createdAt: undefined })).toBeNull();
  });

  it("returns null for a non-object row", () => {
    expect(parseAgentRunTurn("nonsense")).toBeNull();
  });

  it("defaults a malformed envelope to an empty record", () => {
    expect(
      parseAgentRunTurn({ ...wire, envelope: "not-an-object" }),
    ).toMatchObject({
      envelope: {},
    });
  });
});
