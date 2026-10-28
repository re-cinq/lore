import { describe, it, expect, beforeEach, afterEach } from "vitest";
import Hapi from "@hapi/hapi";
import {
  makePool,
  LEGACY_TOKEN,
} from "@re-cinq/lore-server-core/test-helpers/http-mock.js";
import {
  bearerScope,
  principalOf,
  registerBearerScope,
} from "./bearer-scope.js";

const originalEnv = { ...process.env };

function serve(pool: unknown): Hapi.Server {
  const server = Hapi.server();

  registerBearerScope(server, () => pool as never);
  server.route({
    method: "GET",
    path: "/who",
    options: bearerScope("read"),
    handler: (request) => principalOf(request),
  });

  return server;
}

describe("principalOf", () => {
  beforeEach(() => {
    process.env.LORE_INGEST_TOKEN = LEGACY_TOKEN;
  });
  afterEach(() => {
    process.env = { ...originalEnv };
  });

  it("hands the route the person a user token belongs to", async () => {
    const pool = makePool();

    pool.query.mockResolvedValue({
      rows: [
        {
          scopes: ["read"],
          kind: "user",
          login: "gedaiu",
          displayName: "Bogdan",
          avatarUrl: "https://a/1",
          repos: ["re-cinq/lore"],
        },
      ],
    });
    const res = await serve(pool).inject({
      method: "GET",
      url: "/who",
      headers: { authorization: "Bearer user-token" },
    });

    expect(JSON.parse(res.payload)).toMatchObject({
      scopes: ["read"],
      user: { login: "gedaiu", name: "Bogdan", repos: ["re-cinq/lore"] },
    });
  });

  it("hands the route no person for the legacy token", async () => {
    const res = await serve(null).inject({
      method: "GET",
      url: "/who",
      headers: { authorization: `Bearer ${LEGACY_TOKEN}` },
    });

    expect(JSON.parse(res.payload)).toMatchObject({
      user: null,
      tokenHash: null,
    });
  });
});
