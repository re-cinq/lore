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

const packSyncOf = (agents: string[]) =>
  JSON.stringify({
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
  });

const poolOfPack = (agents: string[]) =>
  ({
    query: async () => ({ rows: [{ value: packSyncOf(agents) }] }),
  }) as unknown as Pool;

async function floorWithFixCi(): Promise<InMemoryAgentDefinitions> {
  const floor = new InMemoryAgentDefinitions();

  await floor.put("fix-ci", FIX_CI);

  return floor;
}

async function server(
  floor: InMemoryAgentDefinitions | null,
  pool: Pool = auditPool,
): Promise<Hapi.Server> {
  const s = Hapi.server();

  registerBearerScope(s, () => pool);
  s.route(
    orgAgentDefinitionUpdateRoute(
      () => pool,
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

  it("answers 409 pack_managed and leaves the floor's fix-ci on claude-sonnet-4-6 when the pack manages fix-ci", async () => {
    const floor = await floorWithFixCi();

    const res = await put(await server(floor, poolOfPack(["fix-ci"])), {
      name: "fix-ci",
      model: "claude-opus-4-8",
    });

    expect({
      status: res.statusCode,
      body: JSON.parse(res.payload),
      model: (await floor.get("fix-ci"))?.body.settings.model,
    }).toEqual({
      status: 409,
      body: { error: "pack_managed" },
      model: "claude-sonnet-4-6",
    });
  });

  it("answers 200 for fix-ci when the pack manages only acme-triage", async () => {
    const res = await put(
      await server(await floorWithFixCi(), poolOfPack(["acme-triage"])),
      { name: "fix-ci", timeout_minutes: 45 },
    );

    expect(res.statusCode).toBe(200);
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

  it("stores https://skills.test/verbatim in fix-ci's skills_source when adjust_skill_models is false", async () => {
    process.env.LORE_SKILLS_URL = "https://skills.test";
    const floor = await floorWithFixCi();

    await put(await server(floor), {
      name: "fix-ci",
      adjust_skill_models: false,
    });

    expect((await floor.get("fix-ci"))?.body.settings.config).toEqual({
      skills: ["lore-context"],
      skills_source: "https://skills.test/verbatim",
    });
  });

  it("puts the search MCP server with its X-API-Key header into fix-ci's config, keeping its skill", async () => {
    const floor = await floorWithFixCi();
    const search = {
      name: "search",
      transport: "http",
      url: "https://search.test/mcp",
      headers: [{ name: "X-API-Key", ref: "search-api-key" }],
    };

    await put(await server(floor), { name: "fix-ci", mcp_servers: [search] });

    expect((await floor.get("fix-ci"))?.body.settings.config).toEqual({
      skills: ["lore-context"],
      mcp_servers: [search],
    });
  });

  it("removes fix-ci's MCP servers when mcp_servers is an empty list", async () => {
    const floor = new InMemoryAgentDefinitions();

    await floor.put("fix-ci", {
      settings: {
        ...FIX_CI.settings,
        config: {
          skills: ["lore-context"],
          mcp_servers: [{ name: "files", transport: "stdio", command: "npx" }],
        },
      },
    });

    await put(await server(floor), { name: "fix-ci", mcp_servers: [] });

    expect((await floor.get("fix-ci"))?.body.settings.config).toEqual({
      skills: ["lore-context"],
    });
  });

  it("replaces fix-ci's skills lore-context with cli-design", async () => {
    const floor = await floorWithFixCi();

    await put(await server(floor), { name: "fix-ci", skills: ["cli-design"] });

    expect((await floor.get("fix-ci"))?.body.settings.config).toEqual({
      skills: ["cli-design"],
    });
  });

  it("removes fix-ci's skills when skills is an empty list", async () => {
    const floor = await floorWithFixCi();

    await put(await server(floor), { name: "fix-ci", skills: [] });

    expect((await floor.get("fix-ci"))?.body.settings.config).toBeUndefined();
  });

  it("sets fix-ci's skills_source to LORE_SKILLS_URL when cli-design is added and it has none", async () => {
    process.env.LORE_SKILLS_URL = "https://skills.test";
    const floor = await floorWithFixCi();

    await put(await server(floor), { name: "fix-ci", skills: ["cli-design"] });

    expect((await floor.get("fix-ci"))?.body.settings.config).toEqual({
      skills: ["cli-design"],
      skills_source: "https://skills.test",
    });
  });

  it("answers 400 invalid_agent for an http MCP server with no url", async () => {
    const res = await put(await server(await floorWithFixCi()), {
      name: "fix-ci",
      mcp_servers: [{ name: "search", transport: "http" }],
    });

    expect({
      status: res.statusCode,
      error: JSON.parse(res.payload).error,
    }).toEqual({ status: 400, error: "invalid_agent" });
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

  it("puts image ghcr.io/acme/runner:2 on fix-ci's settings", async () => {
    const floor = await floorWithFixCi();

    const res = await put(await server(floor), {
      name: "fix-ci",
      image: "ghcr.io/acme/runner:2",
    });

    expect({
      status: res.statusCode,
      image: (await floor.get("fix-ci"))?.body.settings.image,
    }).toEqual({ status: 200, image: "ghcr.io/acme/runner:2" });
  });

  it("saves a 4Gi memory limit when image is null, keeping fix-ci's image", async () => {
    const floor = await floorWithFixCi();

    const res = await put(await server(floor), {
      name: "fix-ci",
      image: null,
      pod_resources: { limits: { memory: "4Gi" } },
    });

    expect({
      status: res.statusCode,
      settings: (await floor.get("fix-ci"))?.body.settings,
    }).toMatchObject({
      status: 200,
      settings: {
        image: "ghcr.io/re-cinq/agent:1",
        config: {
          skills: ["lore-context"],
          pod_resources: { limits: { memory: "4Gi" } },
        },
      },
    });
  });

  it("replaces fix-ci's requests.cpu 500m with the sent limits.memory 4Gi, so a blanked quantity is cleared", async () => {
    const floor = new InMemoryAgentDefinitions();

    await floor.put("fix-ci", {
      settings: {
        ...FIX_CI.settings,
        config: { pod_resources: { requests: { cpu: "500m" } } },
      },
    });

    await put(await server(floor), {
      name: "fix-ci",
      pod_resources: { limits: { memory: "4Gi" } },
    });

    expect((await floor.get("fix-ci"))?.body.settings.config).toEqual({
      pod_resources: { limits: { memory: "4Gi" } },
    });
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
