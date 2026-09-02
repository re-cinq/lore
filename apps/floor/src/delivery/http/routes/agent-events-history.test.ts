import { describe, it, expect, afterEach, vi } from "vitest";
import Hapi from "@hapi/hapi";
import { registerBearerAuth } from "../auth.js";
import {
  parseLimit,
  parseAfter,
  agentEventsHistoryRoute,
  DEFAULT_LIMIT,
  MAX_LIMIT,
} from "./agent-events-history.js";
import type { AgentRunEventRow } from "@re-cinq/lore-shared";

const ORIG = process.env.LORE_INGEST_TOKEN;

afterEach(() => {
  if (ORIG === undefined) {
    delete process.env.LORE_INGEST_TOKEN;

    return;
  }
  process.env.LORE_INGEST_TOKEN = ORIG;
});

function row(id: string): AgentRunEventRow {
  return {
    id,
    taskId: "task-1",
    agentCrName: "05fc5491-implement",
    assemblyLineId: "line-1",
    stationRunId: null,
    nodeId: "implement",
    iteration: 1,
    eventType: "tool_call",
    toolName: "Edit",
    toolUseId: "tu-1",
    isError: false,
    filePaths: [],
    summary: null,
    payload: {},
    createdAt: new Date("2026-07-20T10:00:00.000Z"),
  };
}

function historyServer(listSince = vi.fn(() => Promise.resolve([row("1")]))) {
  const server = Hapi.server({ port: 0 });

  registerBearerAuth(server);
  server.route(agentEventsHistoryRoute({ listSince }));

  return { server, listSince };
}

describe("parseLimit", () => {
  it("returns 1000 for a missing limit", () => {
    expect(parseLimit(undefined)).toBe(DEFAULT_LIMIT);
  });

  it("returns 5000 for a limit above the cap", () => {
    expect(parseLimit("999999")).toBe(MAX_LIMIT);
  });

  it("returns 1000 for a non-numeric limit", () => {
    expect(parseLimit("many")).toBe(DEFAULT_LIMIT);
  });

  it("returns 1000 for a zero limit", () => {
    expect(parseLimit("0")).toBe(DEFAULT_LIMIT);
  });

  it("returns 25 for a limit of 25", () => {
    expect(parseLimit("25")).toBe(25);
  });
});

describe("parseAfter", () => {
  it("returns 0 for a missing cursor", () => {
    expect(parseAfter(undefined)).toBe("0");
  });

  it("returns 0 for a non-numeric cursor", () => {
    expect(parseAfter("abc")).toBe("0");
  });

  it("returns 4213 for a cursor of 4213", () => {
    expect(parseAfter("4213")).toBe("4213");
  });
});

describe("GET /api/agent-events/{assemblyLineId}", () => {
  it("returns 401 when the bearer token does not match", async () => {
    process.env.LORE_INGEST_TOKEN = "ingest-secret";
    const res = await historyServer().server.inject({
      method: "GET",
      url: "/api/agent-events/line-1",
      headers: { authorization: "Bearer wrong" },
    });

    expect(res.statusCode).toBe(401);
  });

  it("returns the events for the assembly line after the cursor", async () => {
    process.env.LORE_INGEST_TOKEN = "ingest-secret";
    const { server, listSince } = historyServer();
    const res = await server.inject({
      method: "GET",
      url: "/api/agent-events/line-1?after=7&limit=25",
      headers: { authorization: "Bearer ingest-secret" },
    });

    expect(res.statusCode).toBe(200);
    expect(listSince).toHaveBeenCalledWith("line-1", "7", 25);
    expect(JSON.parse(res.payload)).toMatchObject({
      events: [{ id: "1", assemblyLineId: "line-1" }],
    });
  });

  it("defaults after to 0 and limit to 1000", async () => {
    process.env.LORE_INGEST_TOKEN = "ingest-secret";
    const { server, listSince } = historyServer();

    await server.inject({
      method: "GET",
      url: "/api/agent-events/line-1",
      headers: { authorization: "Bearer ingest-secret" },
    });

    expect(listSince).toHaveBeenCalledWith("line-1", "0", 1000);
  });

  it("clamps limit to 5000", async () => {
    process.env.LORE_INGEST_TOKEN = "ingest-secret";
    const { server, listSince } = historyServer();

    await server.inject({
      method: "GET",
      url: "/api/agent-events/line-1?limit=100000",
      headers: { authorization: "Bearer ingest-secret" },
    });

    expect(listSince).toHaveBeenCalledWith("line-1", "0", 5000);
  });
});
