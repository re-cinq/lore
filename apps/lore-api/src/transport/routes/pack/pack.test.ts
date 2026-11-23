import { describe, it, expect, beforeEach, afterEach } from "vitest";
import Hapi from "@hapi/hapi";
import type { Pool } from "pg";
import type { PackSyncState } from "@re-cinq/lore-shared";
import { registerBearerScope } from "../../http/bearer-scope.js";
import { packRoutes, type PackSeams } from "./pack.js";
import {
  AUTH,
  LEGACY_TOKEN,
} from "@re-cinq/lore-server-core/test-helpers/http-mock.js";

const originalEnv = { ...process.env };
const POOL = {} as Pool;

const SYNCED: PackSyncState = {
  repo: "acme/lore-pack",
  ref: "main",
  commit: "a1b2c3d",
  applied_at: "2026-11-17T10:00:00.000Z",
  agent_count: 2,
  line_count: 1,
  extra_count: 1,
  refused_files: [],
  agents: ["triager", "reviewer"],
  pipelines: ["triage"],
  skill_count: 1,
  skills: ["acme-review"],
  error: null,
  error_at: null,
};

const CONFIGURED: PackSeams = {
  config: () => ({ repo: "acme/lore-pack", ref: "main" }),
  readSync: async () => SYNCED,
  sync: async () => ({
    status: "applied",
    commit: "a1b2c3d",
    changed: ["triager"],
  }),
};

const NOT_CONFIGURED: PackSeams = {
  ...CONFIGURED,
  config: () => null,
  readSync: async () => null,
};

async function request(
  seams: PackSeams,
  method: "GET" | "POST",
  url: string,
  pool: Pool | null,
) {
  const server = Hapi.server();

  registerBearerScope(server, () => null);
  server.route(packRoutes(() => pool, seams));
  const res = await server.inject({ method, url, headers: AUTH });

  return { status: res.statusCode, body: JSON.parse(res.payload) };
}

const call = (seams: PackSeams, method: "GET", pool: Pool | null = POOL) =>
  request(seams, method, "/api/pack", pool);

const callSync = (seams: PackSeams, pool: Pool | null = POOL) =>
  request(seams, "POST", "/api/pack/sync", pool);

describe("GET /api/pack", () => {
  beforeEach(() => {
    process.env.LORE_INGEST_TOKEN = LEGACY_TOKEN;
  });
  afterEach(() => {
    process.env = { ...originalEnv };
  });

  it("answers the configured repo, its ref and the last sync", async () => {
    expect(await call(CONFIGURED, "GET")).toEqual({
      status: 200,
      body: {
        configured: true,
        repo: "acme/lore-pack",
        ref: "main",
        sync: SYNCED,
      },
    });
  });

  it("answers configured false with no repo and no sync when LORE_PACK_REPO is unset", async () => {
    expect(await call(NOT_CONFIGURED, "GET")).toEqual({
      status: 200,
      body: { configured: false, repo: null, ref: null, sync: null },
    });
  });

  it("answers 503 when there is no database", async () => {
    expect((await call(CONFIGURED, "GET", null)).status).toBe(503);
  });
});

describe("POST /api/pack/sync", () => {
  beforeEach(() => {
    process.env.LORE_INGEST_TOKEN = LEGACY_TOKEN;
  });
  afterEach(() => {
    process.env = { ...originalEnv };
  });

  it("answers the result of the sync it ran", async () => {
    const synced: PackSeams = {
      ...CONFIGURED,
      sync: async () => ({ skipped: "lease held" }),
    };

    expect(await callSync(synced)).toEqual({
      status: 200,
      body: { skipped: "lease held" },
    });
  });

  it("answers the applied commit and what changed", async () => {
    expect(await callSync(CONFIGURED)).toEqual({
      status: 200,
      body: { status: "applied", commit: "a1b2c3d", changed: ["triager"] },
    });
  });

  it("answers unconfigured when LORE_PACK_REPO is unset", async () => {
    const unconfigured: PackSeams = {
      ...NOT_CONFIGURED,
      sync: async () => ({ status: "unconfigured" }),
    };

    expect(await callSync(unconfigured)).toEqual({
      status: 200,
      body: { status: "unconfigured" },
    });
  });

  it("answers 503 on the sync when there is no database", async () => {
    expect((await callSync(CONFIGURED, null)).status).toBe(503);
  });
});
