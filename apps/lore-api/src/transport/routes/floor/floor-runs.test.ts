import Hapi from "@hapi/hapi";
import { describe, expect, it } from "vitest";
import { floorRunsRoute, type FloorRunPageOf } from "./floor-runs.js";

function serve(pageOf: FloorRunPageOf) {
  const server = Hapi.server();

  server.auth.scheme("stub", () => ({
    authenticate: (_r, h) => h.authenticated({ credentials: {} }),
  }));
  server.auth.strategy("bearer-scope", "stub");
  server.auth.default("bearer-scope");
  server.route(floorRunsRoute(pageOf));

  return server;
}

describe("GET /api/floor-runs", () => {
  it("asks for the failed runs after page-2, ten of them, and answers the page", async () => {
    const asked: unknown[] = [];
    const server = serve(async (query) => {
      asked.push(query);

      return { runs: [], next_cursor: "page-3" };
    });
    const res = await server.inject(
      "/api/floor-runs?status=failed&cursor=page-2&limit=10",
    );

    expect({ status: res.statusCode, body: res.result, asked }).toEqual({
      status: 200,
      body: { runs: [], next_cursor: "page-3" },
      asked: [{ status: "failed", cursor: "page-2", limit: 10 }],
    });
  });
});
