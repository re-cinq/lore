import { describe, it, expect, beforeEach, afterEach } from "vitest";
import Hapi from "@hapi/hapi";
import type { Pool } from "pg";
import { registerBearerScope } from "../../http/bearer-scope.js";
import { orgAgentDefinitionUpdateRoute } from "./org-update.js";
import { InMemoryAgentDefinitions } from "@re-cinq/lore-shared/project/agents/agent-defs-floor.fixture.js";
import {
  AUTH,
  LEGACY_TOKEN,
} from "@re-cinq/lore-server-core/test-helpers/http-mock.js";

const originalEnv = { ...process.env };

const FIX_CI = {
  settings: {
    model: "claude-sonnet-4-6",
    prompt: "Fix the CI.",
    image: "ghcr.io/re-cinq/agent:1",
    timeoutMinutes: 30,
    config: { skills: ["lore-context"] },
  },
};

const auditPool = {
  query: async () => ({ rows: [] }),
} as unknown as Pool;

async function floorWithFixCi(): Promise<InMemoryAgentDefinitions> {
  const floor = new InMemoryAgentDefinitions();

  await floor.put("fix-ci", FIX_CI);

  return floor;
}

async function server(
  floor: InMemoryAgentDefinitions | null,
): Promise<Hapi.Server> {
  const s = Hapi.server();

  registerBearerScope(s, () => auditPool);
  s.route(
    orgAgentDefinitionUpdateRoute(
      () => auditPool,
      () => floor,
    ),
  );

  return s;
}

function put(s: Hapi.Server, payload: Record<string, unknown>) {
  return s.inject({
    method: "PUT",
    url: "/api/agent-definitions/fix-ci",
    headers: AUTH,
    payload,
  });
}

describe("PUT /api/agent-definitions/{name}", () => {
  beforeEach(() => {
    process.env.LORE_INGEST_TOKEN = LEGACY_TOKEN;
  });
  afterEach(() => {
    process.env = { ...originalEnv };
  });

  it("puts fix-ci's settings on the floor with model claude-opus-4-8 and timeout 45, answering the written definition", async () => {
    const floor = await floorWithFixCi();

    const res = await put(await server(floor), {
      name: "fix-ci",
      model: "claude-opus-4-8",
      timeout_minutes: 45,
    });

    expect({
      body: JSON.parse(res.payload),
      settings: (await floor.get("fix-ci"))?.body.settings,
    }).toMatchObject({
      body: {
        ok: true,
        agent: { name: "fix-ci", model: "claude-opus-4-8", project_id: null },
      },
      settings: { model: "claude-opus-4-8", timeoutMinutes: 45 },
    });
  });

  it("merges a 4Gi memory limit into fix-ci's config, keeping its lore-context skill", async () => {
    const floor = await floorWithFixCi();

    await put(await server(floor), {
      name: "fix-ci",
      pod_resources: { limits: { memory: "4Gi" } },
    });

    expect((await floor.get("fix-ci"))?.body.settings.config).toEqual({
      skills: ["lore-context"],
      pod_resources: { limits: { memory: "4Gi" } },
    });
  });

  it("keeps fix-ci's config as it was when the PUT never mentions pod_resources", async () => {
    const floor = await floorWithFixCi();

    await put(await server(floor), {
      name: "fix-ci",
      model: "claude-opus-4-8",
    });

    expect((await floor.get("fix-ci"))?.body.settings.config).toEqual({
      skills: ["lore-context"],
    });
  });

  it("refuses the write with 503 no_floor when no floor is configured", async () => {
    const res = await put(await server(null), {
      name: "fix-ci",
      model: "claude-opus-4-8",
    });

    expect({
      status: res.statusCode,
      error: JSON.parse(res.payload).error,
    }).toEqual({
      status: 503,
      error: "no_floor",
    });
  });

  it("rejects a non-empty image with 400 — org image changes go through the per-repo two-key flow", async () => {
    const res = await put(await server(await floorWithFixCi()), {
      name: "fix-ci",
      image: "ghcr.io/acme/runner:1",
    });

    expect(res.statusCode).toBe(400);
    expect(JSON.parse(res.payload).error).toBe("image_org_gated");
  });

  it("rejects an invalid body with 400 invalid_agent", async () => {
    const res = await put(await server(await floorWithFixCi()), {
      name: "fix-ci",
      timeout_minutes: 5000,
    });

    expect(res.statusCode).toBe(400);
    expect(JSON.parse(res.payload).error).toBe("invalid_agent");
  });
});
