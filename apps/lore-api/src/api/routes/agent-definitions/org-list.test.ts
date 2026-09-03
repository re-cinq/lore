import { describe, it, expect, beforeEach, afterEach } from "vitest";
import Hapi from "@hapi/hapi";
import type { Pool } from "pg";
import { registerBearerScope } from "../../../server/plugins/bearer-scope.js";
import { orgAgentDefinitionsRoute } from "./org-list.js";
import {
  AUTH,
  LEGACY_TOKEN,
} from "@re-cinq/lore-server-core/test-helpers/http-mock.js";

const originalEnv = { ...process.env };

function fakePool(rows: Array<Record<string, unknown>>): Pool {
  return {
    query: async () => ({ rows }),
  } as unknown as Pool;
}

async function server(pool: Pool | null): Promise<Hapi.Server> {
  const s = Hapi.server();

  registerBearerScope(s, () => pool);
  s.route(orgAgentDefinitionsRoute(() => pool));

  return s;
}

describe("GET /api/agent-definitions", () => {
  beforeEach(() => {
    process.env.LORE_INGEST_TOKEN = LEGACY_TOKEN;
  });
  afterEach(() => {
    process.env = { ...originalEnv };
  });

  it("lists the org-default catalog with no project layer applied", async () => {
    const s = await server(
      fakePool([
        {
          name: "implementation",
          model: "claude-sonnet-4-6",
          timeout_minutes: 90,
          prompt: "Implement.",
          image: null,
          execution_mode: "claude-code",
          review_required: true,
          project_id: null,
          config: null,
        },
      ]),
    );
    const res = await s.inject({
      method: "GET",
      url: "/api/agent-definitions",
      headers: AUTH,
    });

    expect(res.statusCode).toBe(200);
    const { agents } = JSON.parse(res.payload) as {
      agents: Array<Record<string, unknown>>;
    };
    const implementation = agents.find((a) => a.name === "implementation");

    expect(implementation).toMatchObject({
      model: "claude-sonnet-4-6",
      timeout_minutes: 90,
      project_id: null,
    });
  });

  it("answers 503 without a database", async () => {
    const s = await server(null);
    const res = await s.inject({
      method: "GET",
      url: "/api/agent-definitions",
      headers: AUTH,
    });

    expect(res.statusCode).toBe(503);
  });
});
