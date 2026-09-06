import { describe, it, expect, afterEach, vi } from "vitest";
import Hapi from "@hapi/hapi";
import { registerBearerAuth } from "../auth.js";
import { agentTurnsByTaskRoute } from "./agent-turns-by-task.js";
import {
  agentTurnsHistoryRoute,
  PAGE_LOOKAHEAD,
} from "./agent-turns-history.js";
import { DEFAULT_LIMIT, MAX_LIMIT } from "./agent-events-history.js";
import type { AgentRunTurnRow } from "@re-cinq/lore-shared";

const ORIG = process.env.LORE_INGEST_TOKEN;

afterEach(() => {
  if (ORIG === undefined) {
    delete process.env.LORE_INGEST_TOKEN;

    return;
  }
  process.env.LORE_INGEST_TOKEN = ORIG;
});

function uncorrelatedRow(id: string): AgentRunTurnRow {
  return {
    id,
    taskId: "task-1",
    agentCrName: null,
    assemblyLineId: null,
    nodeId: null,
    iteration: null,
    stationRunId: null,
    eventType: "assistant",
    envelope: { event: { type: "assistant" } },
    createdAt: new Date("2026-08-12T10:00:00.000Z"),
  };
}

const listing = () =>
  vi.fn((_task: string, _after: string, _limit: number) =>
    Promise.resolve([uncorrelatedRow("1")]),
  );

function turnsServer(listByTask = listing()) {
  const server = Hapi.server({ port: 0 });

  registerBearerAuth(server);
  server.route(agentTurnsByTaskRoute({ listByTask }));

  return { server, listByTask };
}

const get = (server: Hapi.Server, url: string) =>
  server.inject({ method: "GET", url, headers: { authorization: "Bearer t" } });

describe("GET /api/agent-turns/task/{taskId}", () => {
  it("returns the task's turns, reaching rows correlated to no assembly line", async () => {
    process.env.LORE_INGEST_TOKEN = "t";
    const { server } = turnsServer();

    const res = await get(server, "/api/agent-turns/task/task-1");

    expect(res.statusCode).toBe(200);
    expect(res.result).toEqual({
      turns: [uncorrelatedRow("1")],
      hasMore: false,
    });
  });

  it("scopes the read by task and cursor together, not by cursor alone", async () => {
    process.env.LORE_INGEST_TOKEN = "t";
    const { server, listByTask } = turnsServer();

    await get(server, "/api/agent-turns/task/task-1?after=42&limit=25");

    expect(listByTask).toHaveBeenCalledWith(
      "task-1",
      "42",
      25 + PAGE_LOOKAHEAD,
    );
  });

  it("clamps an oversized limit and defaults a missing one, reading one lookahead row past each", async () => {
    process.env.LORE_INGEST_TOKEN = "t";
    const { server, listByTask } = turnsServer();

    await get(server, "/api/agent-turns/task/task-1?limit=999999");
    await get(server, "/api/agent-turns/task/task-1");

    expect(listByTask.mock.calls.map((call) => call[2])).toEqual([
      MAX_LIMIT + PAGE_LOOKAHEAD,
      DEFAULT_LIMIT + PAGE_LOOKAHEAD,
    ]);
  });

  it("reads from the start of the task for a malformed cursor", async () => {
    process.env.LORE_INGEST_TOKEN = "t";
    const { server, listByTask } = turnsServer();

    await get(server, "/api/agent-turns/task/task-1?after=nonsense");

    expect(listByTask.mock.calls[0][1]).toBe("0");
  });

  it("returns 401 without a valid bearer token", async () => {
    process.env.LORE_INGEST_TOKEN = "t";
    const { server } = turnsServer();

    const res = await server.inject({
      method: "GET",
      url: "/api/agent-turns/task/task-1",
      headers: { authorization: "Bearer wrong" },
    });

    expect(res.statusCode).toBe(401);
  });

  it("routes a task read to listByTask, not the registered line route sharing the /api/agent-turns prefix", async () => {
    process.env.LORE_INGEST_TOKEN = "t";
    const { server, listByTask } = turnsServer();
    const listByLine = vi.fn((_line: string, _after: string, _limit: number) =>
      Promise.resolve([]),
    );

    server.route(agentTurnsHistoryRoute({ listByLine }));

    await get(server, "/api/agent-turns/task/line-shaped-uuid");

    expect(listByTask).toHaveBeenCalledWith(
      "line-shaped-uuid",
      "0",
      DEFAULT_LIMIT + PAGE_LOOKAHEAD,
    );
    expect(listByLine).not.toHaveBeenCalled();
  });

  it("reports hasMore and withholds the lookahead row when a row exists past the page", async () => {
    process.env.LORE_INGEST_TOKEN = "t";
    const listByTask = vi.fn((_task: string, _after: string, _limit: number) =>
      Promise.resolve([
        uncorrelatedRow("1"),
        uncorrelatedRow("2"),
        uncorrelatedRow("3"),
      ]),
    );
    const { server } = turnsServer(listByTask);

    const res = await get(server, "/api/agent-turns/task/task-1?limit=2");

    expect(res.result).toEqual({
      turns: [uncorrelatedRow("1"), uncorrelatedRow("2")],
      hasMore: true,
    });
  });

  it("reports hasMore false for an exactly-full page with no row past it", async () => {
    process.env.LORE_INGEST_TOKEN = "t";
    const listByTask = vi.fn((_task: string, _after: string, _limit: number) =>
      Promise.resolve([uncorrelatedRow("1"), uncorrelatedRow("2")]),
    );
    const { server } = turnsServer(listByTask);

    const res = await get(server, "/api/agent-turns/task/task-1?limit=2");

    expect(res.result).toEqual({
      turns: [uncorrelatedRow("1"), uncorrelatedRow("2")],
      hasMore: false,
    });
  });
});
