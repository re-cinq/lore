import { describe, it, expect, beforeEach, afterEach } from "vitest";
import type { Pool } from "pg";
import Hapi from "@hapi/hapi";
import { registerBearerScope } from "../../http/bearer-scope.js";
import { orgAgentDefinitionsRoute } from "./org-list.js";
import { InMemoryAgentDefinitions } from "@re-cinq/lore-shared/project/agents/agent-defs-floor.fixture.js";
import {
  AUTH,
  LEGACY_TOKEN,
} from "@re-cinq/lore-server-core/test-helpers/http-mock.js";

const originalEnv = { ...process.env };

const NO_SYNC = { query: async () => ({ rows: [] }) } as unknown as Pool;

const poolOfPack = (agents: string[]) =>
  ({
    query: async () => ({
      rows: [
        {
          value: JSON.stringify({
            repo: "acme/lore-pack",
            ref: null,
            commit: "9a7b72d96c4cbaadf77c7bcdc9f885dfb099c36d",
            applied_at: "2026-11-17T10:00:00.000Z",
            agent_count: agents.length,
            line_count: 0,
            extra_count: 0,
            refused_files: [],
            agents,
            pipelines: [],
            error: null,
            error_at: null,
          }),
        },
      ],
    }),
  }) as unknown as Pool;

async function server(
  floor: InMemoryAgentDefinitions | null,
  pool: Pool = NO_SYNC,
): Promise<Hapi.Server> {
  const s = Hapi.server();

  registerBearerScope(s, () => pool);
  s.route(
    orgAgentDefinitionsRoute(
      () => pool,
      () => floor,
    ),
  );

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

  it("flags acme-triage pack_managed and loop-tdd not when the pack manages acme-triage", async () => {
    const floor = new InMemoryAgentDefinitions();
    const settings = {
      model: "claude-opus-4-7",
      prompt: "Go.",
      image: "ghcr.io/re-cinq/agent:1",
      timeoutMinutes: 60,
    };

    await floor.put("acme-triage", { settings });
    await floor.put("loop-tdd", { settings });

    expect(
      await listedAgents(await server(floor, poolOfPack(["acme-triage"]))),
    ).toMatchObject([
      { name: "acme-triage", pack_managed: true },
      { name: "loop-tdd", pack_managed: false },
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
