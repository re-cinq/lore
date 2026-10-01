import Hapi from "@hapi/hapi";
import { describe, expect, it } from "vitest";
import { floorNodeLogsRoute, type NodeLogsOf } from "./node-logs.js";

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
  server.route(floorNodeLogsRoute(logsOf));

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
