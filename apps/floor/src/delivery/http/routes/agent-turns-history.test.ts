import { describe, it, expect, afterEach, vi } from "vitest";
import Hapi from "@hapi/hapi";
import { registerBearerAuth } from "../auth.js";
import { agentTurnsHistoryRoute } from "./agent-turns-history.js";
import type { AgentRunTurnRow } from "@re-cinq/lore-shared";

const ORIG = process.env.LORE_INGEST_TOKEN;

afterEach(() => {
  if (ORIG === undefined) {
    delete process.env.LORE_INGEST_TOKEN;

    return;
  }
  process.env.LORE_INGEST_TOKEN = ORIG;
});

function row(id: string): AgentRunTurnRow {
  return {
    id,
    taskId: "task-1",
    agentCrName: "05fc5491-implement",
    assemblyLineId: "line-1",
    stationRunId: null,
    nodeId: "implement",
    iteration: 1,
    eventType: "assistant",
    envelope: { event: { type: "assistant" } },
    createdAt: new Date("2026-08-07T10:00:00.000Z"),
  };
}

const listing = () =>
  vi.fn((_line: string, _after: string, _limit: number) =>
    Promise.resolve([row("1")]),
  );

function turnsServer(listByLine = listing()) {
  const server = Hapi.server({ port: 0 });

  registerBearerAuth(server);
  server.route(agentTurnsHistoryRoute({ listByLine }));

  return { server, listByLine };
}

const get = (server: Hapi.Server, url: string) =>
  server.inject({ method: "GET", url, headers: { authorization: "Bearer t" } });

describe("GET /api/agent-turns/{assemblyLineId}", () => {
  it("returns the line's turns with their untruncated envelopes", async () => {
    process.env.LORE_INGEST_TOKEN = "t";
    const { server } = turnsServer();

    const res = await get(server, "/api/agent-turns/line-1");

    expect(res.statusCode).toBe(200);
    expect(res.result).toEqual({ turns: [row("1")] });
  });

  it("scopes the read by assembly line and cursor together, not by cursor alone", async () => {
    process.env.LORE_INGEST_TOKEN = "t";
    const { server, listByLine } = turnsServer();

    await get(server, "/api/agent-turns/line-1?after=42&limit=25");

    expect(listByLine).toHaveBeenCalledWith("line-1", "42", 25);
  });

  it("clamps an oversized limit and defaults a missing one", async () => {
    process.env.LORE_INGEST_TOKEN = "t";
    const { server, listByLine } = turnsServer();

    await get(server, "/api/agent-turns/line-1?limit=999999");
    await get(server, "/api/agent-turns/line-1");

    expect(listByLine.mock.calls.map((call) => call[2])).toEqual([5000, 1000]);
  });

  it("reads from the start of the run for a malformed cursor", async () => {
    process.env.LORE_INGEST_TOKEN = "t";
    const { server, listByLine } = turnsServer();

    await get(server, "/api/agent-turns/line-1?after=nonsense");

    expect(listByLine.mock.calls[0][1]).toBe("0");
  });

  it("returns 401 without a valid bearer token", async () => {
    process.env.LORE_INGEST_TOKEN = "t";
    const { server } = turnsServer();

    const res = await server.inject({
      method: "GET",
      url: "/api/agent-turns/line-1",
      headers: { authorization: "Bearer wrong" },
    });

    expect(res.statusCode).toBe(401);
  });
});
