import Hapi from "@hapi/hapi";
import { describe, expect, it } from "vitest";
import {
  visitEventsRoute,
  visitModelCallsRoute,
  type VisitEventsOf,
  type VisitModelCallsOf,
} from "./visit-reads.js";

const CALL = {
  seq: 1,
  occurredAt: "2026-10-10T10:00:00.000Z",
  model: "gemini-3.1-pro",
  costUsd: 0.02,
  tokensIn: 1000,
  tokensOut: 120,
};

const EVENT = {
  id: "2",
  name: "station_run.dispatch",
  direction: "handled",
  inferred: false,
  created_at: "2026-10-10T10:00:00.000Z",
  acked_at: "2026-10-10T10:00:01.000Z",
  claimed_by: "cluster-agent-1",
  attempts: 1,
  last_error: null,
  dead_at: null,
  payload: { visitId: "visit-1" },
} as const;

function serve(
  callsOf: VisitModelCallsOf = async () => null,
  eventsOf: VisitEventsOf = async () => null,
) {
  const server = Hapi.server();

  server.auth.scheme("stub", () => ({
    authenticate: (_r, h) => h.authenticated({ credentials: {} }),
  }));
  server.auth.strategy("bearer-scope", "stub");
  server.auth.default("bearer-scope");
  server.route([visitModelCallsRoute(callsOf), visitEventsRoute(eventsOf)]);

  return server;
}

describe("GET /api/assembly-runs/{id}/visits/{visitId}/model-calls", () => {
  it("answers visit-1's model calls under a calls key", async () => {
    const asked: unknown[] = [];
    const res = await serve(async (...args) => {
      asked.push(args);

      return [CALL];
    }).inject("/api/assembly-runs/run-1/visits/visit-1/model-calls");

    expect({ status: res.statusCode, body: res.result, asked }).toEqual({
      status: 200,
      body: { calls: [CALL] },
      asked: [["run-1", "visit-1"]],
    });
  });

  it("answers 404 for a visit of no run the floor has", async () => {
    const res = await serve().inject(
      "/api/assembly-runs/run-1/visits/visit-9/model-calls",
    );

    expect(res.statusCode).toBe(404);
  });
});

describe("GET /api/assembly-runs/{id}/visits/{visitId}/events", () => {
  it("answers the events visit-1 handled and raised under an events key", async () => {
    const res = await serve(undefined, async () => [EVENT]).inject(
      "/api/assembly-runs/run-1/visits/visit-1/events",
    );

    expect({ status: res.statusCode, body: res.result }).toEqual({
      status: 200,
      body: { events: [EVENT] },
    });
  });

  it("answers 404 for a visit of no run the floor has", async () => {
    const res = await serve().inject(
      "/api/assembly-runs/run-1/visits/visit-9/events",
    );

    expect(res.statusCode).toBe(404);
  });
});
