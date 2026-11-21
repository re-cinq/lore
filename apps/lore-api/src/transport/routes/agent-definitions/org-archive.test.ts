import { describe, it, expect, afterEach, beforeEach } from "vitest";
import Hapi from "@hapi/hapi";
import type { Pool } from "pg";
import { registerBearerScope } from "../../http/bearer-scope.js";
import { orgAgentDefinitionArchiveRoute } from "./org-archive.js";
import { InMemoryAgentDefinitions } from "@re-cinq/lore-shared/project/agents/agent-defs-floor.fixture.js";
import {
  AUTH,
  LEGACY_TOKEN,
} from "@re-cinq/lore-server-core/test-helpers/http-mock.js";

const SETTINGS = {
  settings: {
    model: "claude-sonnet-4-6",
    prompt: "Walk the change and note what it does.",
    image: "ghcr.io/re-cinq/agent:1",
    timeoutMinutes: 30,
  },
};

const originalEnv = { ...process.env };

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

async function floorHolding(
  ...names: string[]
): Promise<InMemoryAgentDefinitions> {
  const floor = new InMemoryAgentDefinitions();

  await Promise.all(names.map((name) => floor.put(name, SETTINGS)));

  return floor;
}

function archive(
  floor: InMemoryAgentDefinitions | null,
  name: string,
  pool: Pool = poolOfPack([]),
) {
  const s = Hapi.server();

  registerBearerScope(s, () => pool);
  s.route(
    orgAgentDefinitionArchiveRoute(
      () => pool,
      () => floor,
    ),
  );

  return s.inject({
    method: "DELETE",
    url: `/api/agent-definitions/${name}`,
    headers: AUTH,
  });
}

describe("DELETE /api/agent-definitions/{name}", () => {
  beforeEach(() => {
    process.env.LORE_INGEST_TOKEN = LEGACY_TOKEN;
  });
  afterEach(() => {
    process.env = { ...originalEnv };
  });

  it("archives walk-note on the floor and answers 200", async () => {
    const floor = await floorHolding("walk-note");

    const res = await archive(floor, "walk-note");

    expect({ status: res.statusCode, body: res.result }).toEqual({
      status: 200,
      body: { ok: true, archived: "walk-note" },
    });
    expect(await floor.get("walk-note")).toBeNull();
  });

  it("answers 404 for an agent the floor does not hold", async () => {
    const res = await archive(await floorHolding(), "walk-note");

    expect(res.statusCode).toBe(404);
  });

  it("refuses loop-tdd-round with 409 shipped, since Lore ships it and the next boot would seed it again", async () => {
    const floor = await floorHolding("loop-tdd-round");

    const res = await archive(floor, "loop-tdd-round");

    expect({ status: res.statusCode, body: res.result }).toMatchObject({
      status: 409,
      body: { error: "shipped" },
    });
    expect(await floor.get("loop-tdd-round")).toMatchObject({
      id: "loop-tdd-round",
    });
  });

  it("refuses acme-reviewer with 409 pack_managed when the pack manages it", async () => {
    process.env.LORE_PACK_REPO = "acme/lore-pack";
    const floor = await floorHolding("acme-reviewer");

    const res = await archive(
      floor,
      "acme-reviewer",
      poolOfPack(["acme-reviewer"]),
    );

    expect({ status: res.statusCode, body: res.result }).toMatchObject({
      status: 409,
      body: { error: "pack_managed" },
    });
  });

  it("answers 503 when the deployment has no floor", async () => {
    const res = await archive(null, "walk-note");

    expect(res.statusCode).toBe(503);
  });
});
