import Hapi from "@hapi/hapi";
import { describe, it, expect } from "vitest";
import { makePool } from "@re-cinq/lore-server-core/test-helpers/http-mock.js";
import { serviceVersionsRoute, versionsRoute } from "./versions.js";
import type { VersionSources } from "../../../work/versions/versions-answer.js";

const failing = async (): Promise<never> => {
  throw new Error("down");
};

const allDown: VersionSources = {
  services: failing,
  ui: failing,
  floorVersion: failing,
  migrations: failing,
  onFloor: failing,
  env: { LORE_BUILD_SHA: "abc1234" },
};

function serve(pool: ReturnType<typeof makePool> | null) {
  const server = Hapi.server();

  server.auth.scheme("stub", () => ({
    authenticate: (_r, h) => h.authenticated({ credentials: {} }),
  }));
  server.auth.strategy("bearer-scope", "stub");
  server.auth.default("bearer-scope");
  server.route(versionsRoute(() => pool as never, () => allDown));
  server.route(serviceVersionsRoute(() => pool as never));

  return server;
}

describe("GET /api/versions", () => {
  it("answers 200 with every source's error and the latest build when all are down", async () => {
    const res = await serve(null).inject("/api/versions");

    expect({ status: res.statusCode, body: JSON.parse(res.payload) }).toEqual({
      status: 200,
      body: {
        lore: {
          "lore-api": { error: "down" },
          stations: { error: "down" },
          "lore-mcp": { error: "down" },
          "lore-ui": { error: "down" },
        },
        latest: { build: "abc1234" },
        floor: { error: "down" },
        database: { error: "down" },
        onFloor: { error: "down" },
        agentImage: null,
      },
    });
  });
});

describe("POST /api/service-versions", () => {
  it("records the lore-mcp gateway's start", async () => {
    const pool = makePool();

    const res = await serve(pool).inject({
      method: "POST",
      url: "/api/service-versions",
      payload: { service: "lore-mcp", build: "abc1234", packages: { a: "1" } },
    });

    expect({
      status: res.statusCode,
      params: pool.query.mock.calls[0]?.[1]?.slice(0, 3),
    }).toEqual({
      status: 200,
      params: ["lore-mcp", "abc1234", '{"a":"1"}'],
    });
  });

  it("refuses a service other than the gateway with 400", async () => {
    const res = await serve(makePool()).inject({
      method: "POST",
      url: "/api/service-versions",
      payload: { service: "lore-api", build: "x", packages: {} },
    });

    expect(res.statusCode).toBe(400);
  });

  it("answers 503 without a pool", async () => {
    const res = await serve(null).inject({
      method: "POST",
      url: "/api/service-versions",
      payload: { service: "lore-mcp", build: "x", packages: {} },
    });

    expect(res.statusCode).toBe(503);
  });
});
