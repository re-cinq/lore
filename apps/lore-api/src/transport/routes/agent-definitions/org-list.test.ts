import { describe, it, expect, beforeEach, afterEach } from "vitest";
import Hapi from "@hapi/hapi";
import { registerBearerScope } from "../../http/bearer-scope.js";
import { orgAgentDefinitionsRoute } from "./org-list.js";
import { InMemoryAgentDefinitions } from "@re-cinq/lore-shared/project/agents/agent-defs-floor.fixture.js";
import {
  AUTH,
  LEGACY_TOKEN,
} from "@re-cinq/lore-server-core/test-helpers/http-mock.js";

const originalEnv = { ...process.env };

async function server(
  floor: InMemoryAgentDefinitions | null,
): Promise<Hapi.Server> {
  const s = Hapi.server();

  registerBearerScope(s, () => null);
  s.route(orgAgentDefinitionsRoute(() => floor));

  return s;
}

async function listedAgents(
  s: Hapi.Server,
): Promise<Array<Record<string, unknown>>> {
  const res = await s.inject({
    method: "GET",
    url: "/api/agent-definitions",
    headers: AUTH,
  });

  return (JSON.parse(res.payload) as { agents: Array<Record<string, unknown>> })
    .agents;
}

describe("GET /api/agent-definitions", () => {
  beforeEach(() => {
    process.env.LORE_INGEST_TOKEN = LEGACY_TOKEN;
  });
  afterEach(() => {
    process.env = { ...originalEnv };
  });

  it("lists the floor's loop-tdd settings on claude-opus-4-7, the re-cinq/otto variant not applied", async () => {
    const floor = new InMemoryAgentDefinitions();

    await floor.put("loop-tdd", {
      settings: {
        model: "claude-opus-4-7",
        prompt: "Make the test pass.",
        image: "ghcr.io/re-cinq/agent:1",
        timeoutMinutes: 60,
      },
      variants: { "github.com/re-cinq/otto": { model: "gemini-3.1-pro" } },
    });

    expect(await listedAgents(await server(floor))).toMatchObject([
      { name: "loop-tdd", model: "claude-opus-4-7", project_id: null },
    ]);
  });

  it("answers 503 no_floor, not the shipped md files, when no floor is configured", async () => {
    const res = await (
      await server(null)
    ).inject({
      method: "GET",
      url: "/api/agent-definitions",
      headers: AUTH,
    });

    expect(res.statusCode).toBe(503);
  });
});
