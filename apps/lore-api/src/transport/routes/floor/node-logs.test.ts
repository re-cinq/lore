import Hapi from "@hapi/hapi";
import { describe, expect, it } from "vitest";
import { nodeLogsReader, nodeLogsRoute, type NodeLogsOf } from "./node-logs.js";

const LOGS = {
  available: true,
  logs: "2026-09-30T10:01:00.000Z kind=lifecycle phase=init",
  phase: "Succeeded",
  podName: null,
  archived: true,
} as const;

function serve(logsOf: NodeLogsOf) {
  const server = Hapi.server();

  server.auth.scheme("stub", () => ({
    authenticate: (_r, h) => h.authenticated({ credentials: {} }),
  }));
  server.auth.strategy("bearer-scope", "stub");
  server.auth.default("bearer-scope");
  server.route(nodeLogsRoute(logsOf));

  return server;
}

describe("GET /api/assembly-runs/{id}/nodes/{name}/logs", () => {
  it("answers the log of floor-visit-1 of run-1, tail 20", async () => {
    const asked: unknown[] = [];
    const server = serve(async (...args) => {
      asked.push(args);

      return LOGS;
    });
    const res = await server.inject(
      "/api/assembly-runs/run-1/nodes/floor-visit-1/logs?tail=20",
    );

    expect({ status: res.statusCode, body: res.result, asked }).toEqual({
      status: 200,
      body: LOGS,
      asked: [["run-1", "floor-visit-1", 20]],
    });
  });

  it("answers 404 for a name of no visit of this run", async () => {
    const res = await serve(async () => null).inject(
      "/api/assembly-runs/run-1/nodes/cr-implement/logs",
    );

    expect(res.statusCode).toBe(404);
  });
});

describe("nodeLogsReader", () => {
  const STORED = {
    available: true,
    logs: "stdout",
    phase: "succeeded",
    podName: null,
    archived: true,
  } as const;

  it("answers the stored stdout of a node of a Postgres run without asking the floor", async () => {
    const asked: string[] = [];
    const read = nodeLogsReader(
      () => ({ nodeLogs: async () => STORED }) as never,
      async (runId) => {
        asked.push(runId);

        return LOGS;
      },
    );

    expect({ logs: await read("run-1", "abc-review", 20), asked }).toEqual({
      logs: STORED,
      asked: [],
    });
  });

  it("asks the floor for a name Postgres has no node for", async () => {
    const read = nodeLogsReader(
      () => ({ nodeLogs: async () => null }) as never,
      async () => LOGS,
    );

    expect(await read("run-1", "floor-visit-1", undefined)).toEqual(LOGS);
  });

  it("asks the floor on a deployment with no database", async () => {
    const read = nodeLogsReader(
      () => null,
      async () => LOGS,
    );

    expect(await read("run-1", "floor-visit-1", undefined)).toEqual(LOGS);
  });
});
