import { describe, it, expect } from "vitest";
import { createHash } from "node:crypto";
import Hapi from "@hapi/hapi";
import { makePool } from "@re-cinq/lore-server-core/test-helpers/http-mock.js";
import { bearerScope, registerBearerScope } from "./bearer-scope.js";
import { registerRunRepoGuard } from "./run-repo-guard.js";

const LEGACY = "legacy-service-token";

function lore() {
  const pool = makePool();
  const server = Hapi.server();
  const asked: string[] = [];

  process.env.LORE_INGEST_TOKEN = LEGACY;
  pool.query.mockImplementation(async (_sql: string, [hash]: string[]) => ({
    rows: [personRow(hash)],
  }));
  registerBearerScope(server, () => pool as never);
  registerRunRepoGuard(server, async (runId) => {
    asked.push(runId);

    return runId === "r1" ? "re-cinq/lore" : null;
  });
  server.route([
    {
      method: "GET",
      path: "/api/assembly-runs/{id}/events",
      options: bearerScope("read"),
      handler: () => ({ events: [] }),
    },
    {
      method: "GET",
      path: "/api/assembly-lines/{id}/nodes",
      options: bearerScope("read"),
      handler: () => ({ nodes: [] }),
    },
    {
      method: "GET",
      path: "/api/assembly-runs",
      options: bearerScope("read"),
      handler: () => ({ runs: [] }),
    },
  ]);

  return {
    asked,
    get: (url: string, token: string) =>
      server.inject({ url, headers: { authorization: `Bearer ${token}` } }),
  };
}

function personRow(hash: string) {
  const repos = hash === ANA_HASH ? ["re-cinq/lore"] : ["x/y"];

  return { scopes: ["read"], kind: "user", login: "person", repos };
}

const ANA_HASH = createHash("sha256").update("ana-session").digest("hex");

describe("the run repo guard", () => {
  it("refuses Ben the events of a run in a repo outside his list with 403", async () => {
    const res = await lore().get("/api/assembly-runs/r1/events", "ben-session");

    expect({ status: res.statusCode, body: JSON.parse(res.payload) }).toEqual({
      status: 403,
      body: { error: "repository not allowed" },
    });
  });

  it("refuses Ben run r1's nodes under the older /api/assembly-lines spelling with 403", async () => {
    const res = await lore().get("/api/assembly-lines/r1/nodes", "ben-session");

    expect(res.statusCode).toBe(403);
  });

  it("answers Ana the events of a run in re-cinq/lore", async () => {
    const res = await lore().get("/api/assembly-runs/r1/events", "ana-session");

    expect(res.statusCode).toBe(200);
  });

  it("lets a service token read any run", async () => {
    const { get, asked } = lore();
    const res = await get("/api/assembly-runs/r1/events", LEGACY);

    expect({ status: res.statusCode, asked }).toEqual({
      status: 200,
      asked: [],
    });
  });

  it("answers 404 to a person asking for an unknown run", async () => {
    const res = await lore().get(
      "/api/assembly-runs/nope/events",
      "ana-session",
    );

    expect(res.statusCode).toBe(404);
  });

  it("lets a person list runs without naming one", async () => {
    const res = await lore().get("/api/assembly-runs", "ben-session");

    expect(res.statusCode).toBe(200);
  });
});
