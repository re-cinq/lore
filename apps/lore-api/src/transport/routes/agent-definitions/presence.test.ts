import { describe, it, expect, beforeEach, afterEach } from "vitest";
import Hapi from "@hapi/hapi";
import { registerBearerScope } from "../../http/bearer-scope.js";
import { agentPresenceRoute, type FloorPresence } from "./presence.js";
import {
  AUTH,
  LEGACY_TOKEN,
} from "@re-cinq/lore-server-core/test-helpers/http-mock.js";

const originalEnv = { ...process.env };

const LOOP_TDD_ON_EAST_ONLY = {
  "loop-tdd": {
    state: "some" as const,
    latest: "h2",
    clusters: [
      { id: "east", hash: "h2", current: true },
      { id: "west", hash: "h1", current: false },
    ],
  },
};

async function presenceFrom(floor: FloorPresence | null): Promise<unknown> {
  const s = Hapi.server();

  registerBearerScope(s, () => null);
  s.route(agentPresenceRoute(() => floor));
  const res = await s.inject({
    method: "GET",
    url: "/api/agent-definitions/presence",
    headers: AUTH,
  });

  return JSON.parse(res.payload);
}

describe("GET /api/agent-definitions/presence", () => {
  beforeEach(() => {
    process.env.LORE_INGEST_TOKEN = LEGACY_TOKEN;
  });
  afterEach(() => {
    process.env = { ...originalEnv };
  });

  it("relays the floor's answer: loop-tdd some, east on h2 and west still on h1", async () => {
    const floor = { presence: () => Promise.resolve(LOOP_TDD_ON_EAST_ONLY) };

    expect(await presenceFrom(floor)).toEqual({
      presence: LOOP_TDD_ON_EAST_ONLY,
    });
  });

  it("answers no agent at all on a deployment given no floor", async () => {
    expect(await presenceFrom(null)).toEqual({ presence: {} });
  });
});
