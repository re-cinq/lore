import { describe, expect, it } from "vitest";
import type { AgentRunTurnRow } from "@re-cinq/lore-shared/project/agent-run-turns/agent-run-turns-port.js";
import { turnPage, turnPageReader } from "./run-turns.js";

function turn(id: number): AgentRunTurnRow {
  return {
    id: String(id),
    taskId: null,
    agentCrName: "floor-visit-1",
    assemblyLineId: "run-1",
    stationRunId: "visit-1",
    nodeId: "review",
    iteration: 1,
    eventType: "assistant",
    envelope: { source: {}, event: {} },
    createdAt: new Date("2026-09-30T08:00:00.000Z"),
  };
}

const THREE_TURNS = [turn(1), turn(2), turn(3)];

function ids(page: { turns: AgentRunTurnRow[] }): string[] {
  return page.turns.map((row) => row.id);
}

describe("turnPage", () => {
  it("answers every turn and no more when no cursor or limit is given", () => {
    const page = turnPage(THREE_TURNS, {});

    expect({ ids: ids(page), hasMore: page.hasMore }).toEqual({
      ids: ["1", "2", "3"],
      hasMore: false,
    });
  });

  it("answers turns 2 and 3 after cursor 1", () => {
    expect(ids(turnPage(THREE_TURNS, { after: "1" }))).toEqual(["2", "3"]);
  });

  it("answers turn 1 alone with more remaining at limit 1", () => {
    const page = turnPage(THREE_TURNS, { limit: "1" });

    expect({ ids: ids(page), hasMore: page.hasMore }).toEqual({
      ids: ["1"],
      hasMore: true,
    });
  });

  it("answers an empty page for a run with no turns", () => {
    expect(turnPage([], { after: "5" })).toEqual({ turns: [], hasMore: false });
  });
});

describe("turnPageReader", () => {
  it("pages a Postgres run in the database: turns 1 and 2 of 3 with more remaining at limit 2, read one row past the page", async () => {
    const asked: unknown[] = [];
    const read = turnPageReader(
      () =>
        ({
          turns: async (...args: unknown[]) => {
            asked.push(args);

            return THREE_TURNS;
          },
        }) as never,
      async () => [],
    );
    const page = await read("run-1", { after: "0", limit: "2" });

    expect({ ids: ids(page), hasMore: page.hasMore, asked }).toEqual({
      ids: ["1", "2"],
      hasMore: true,
      asked: [["run-1", "0", 3]],
    });
  });

  it("answers the floor's turns for a run Postgres does not have", async () => {
    const read = turnPageReader(
      () => ({ turns: async () => null }) as never,
      async () => THREE_TURNS,
    );

    expect(ids(await read("floor-run", {}))).toEqual(["1", "2", "3"]);
  });
});
