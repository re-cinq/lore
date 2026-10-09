import Hapi from "@hapi/hapi";
import { describe, expect, it } from "vitest";
import { runBagRoute, type RunBagOf } from "./run-bag.js";

const BAG = {
  task_id: { kind: "value", ref: "task-1", by: "lore" },
  target: {
    kind: "git",
    ref: "github.com/re-cinq/lore@main",
    by: "lore",
    sha: "9f2c1d4",
  },
} as const;

function serve(bagOf: RunBagOf) {
  const server = Hapi.server();

  server.auth.scheme("stub", () => ({
    authenticate: (_r, h) => h.authenticated({ credentials: {} }),
  }));
  server.auth.strategy("bearer-scope", "stub");
  server.auth.default("bearer-scope");
  server.route(runBagRoute(bagOf));

  return server;
}

describe("GET /api/assembly-runs/{id}/bag", () => {
  it("answers run-1's bag under a bag key", async () => {
    const asked: unknown[] = [];
    const res = await serve(async (...args) => {
      asked.push(args);

      return BAG;
    }).inject("/api/assembly-runs/run-1/bag");

    expect({ status: res.statusCode, body: res.result, asked }).toEqual({
      status: 200,
      body: { bag: BAG },
      asked: [["run-1"]],
    });
  });

  it("answers 404 for a run the floor does not have", async () => {
    const res = await serve(async () => null).inject(
      "/api/assembly-runs/run-1/bag",
    );

    expect(res.statusCode).toBe(404);
  });
});
