import { describe, it, expect, beforeEach, afterEach } from "vitest";
import Hapi from "@hapi/hapi";
import type { Pool } from "pg";
import { registerBearerScope } from "../../../server/plugins/bearer-scope.js";
import { orgAgentDefinitionUpdateRoute } from "./org-update.js";
import {
  AUTH,
  LEGACY_TOKEN,
} from "@re-cinq/lore-server-core/test-helpers/http-mock.js";

const originalEnv = { ...process.env };

const orgRow = {
  name: "fix-ci",
  model: "claude-sonnet-4-6",
  timeout_minutes: 30,
  prompt: "Fix the CI.",
  image: null,
  execution_mode: "claude-code",
  review_required: false,
  project_id: null,
  config: { skills: ["lore-context"] },
};

/** Answers the resolve SELECT with the org row and echoes the upsert's bound
 *  row back, capturing every call for SQL/param assertions. */
function fakePool(capture: Array<{ text: string; params?: unknown[] }>): Pool {
  return {
    query: async (text: string, params?: unknown[]) => {
      capture.push({ text, params });

      if (/select/i.test(text) && !/insert/i.test(text)) {
        return { rows: [orgRow] };
      }

      return {
        rows: [
          {
            ...orgRow,
            model: params?.[1] ?? orgRow.model,
            timeout_minutes: params?.[2] ?? orgRow.timeout_minutes,
            config: params?.[7] ?? null,
          },
        ],
      };
    },
  } as unknown as Pool;
}

async function server(pool: Pool | null): Promise<Hapi.Server> {
  const s = Hapi.server();

  registerBearerScope(s, () => pool);
  s.route(orgAgentDefinitionUpdateRoute(() => pool));

  return s;
}

describe("PUT /api/agent-definitions/{name}", () => {
  beforeEach(() => {
    process.env.LORE_INGEST_TOKEN = LEGACY_TOKEN;
  });
  afterEach(() => {
    process.env = { ...originalEnv };
  });

  it("upserts the org-default row and returns the written definition", async () => {
    const capture: Array<{ text: string; params?: unknown[] }> = [];
    const s = await server(fakePool(capture));

    const res = await s.inject({
      method: "PUT",
      url: "/api/agent-definitions/fix-ci",
      headers: AUTH,
      payload: {
        name: "fix-ci",
        model: "claude-opus-4-8",
        timeout_minutes: 45,
      },
    });

    expect(res.statusCode).toBe(200);
    expect(JSON.parse(res.payload)).toMatchObject({
      ok: true,
      agent: { name: "fix-ci", model: "claude-opus-4-8", project_id: null },
    });
    const upsert = capture.find((c) => /on conflict \(name\)/i.test(c.text));

    expect(upsert?.text).toMatch(/where project_id is null/i);
  });

  it("merges pod_resources over the resolved org config on the written row", async () => {
    const capture: Array<{ text: string; params?: unknown[] }> = [];
    const s = await server(fakePool(capture));

    const res = await s.inject({
      method: "PUT",
      url: "/api/agent-definitions/fix-ci",
      headers: AUTH,
      payload: {
        name: "fix-ci",
        pod_resources: { limits: { memory: "4Gi" } },
      },
    });

    expect(res.statusCode).toBe(200);
    const upsert = capture.find((c) => /on conflict \(name\)/i.test(c.text));

    expect(upsert?.params?.[7]).toEqual({
      skills: ["lore-context"],
      pod_resources: { limits: { memory: "4Gi" } },
    });
  });

  it("rejects a non-empty image with 400 — org image changes go through the per-repo two-key flow", async () => {
    const s = await server(fakePool([]));

    const res = await s.inject({
      method: "PUT",
      url: "/api/agent-definitions/fix-ci",
      headers: AUTH,
      payload: { name: "fix-ci", image: "ghcr.io/acme/runner:1" },
    });

    expect(res.statusCode).toBe(400);
    expect(JSON.parse(res.payload).error).toBe("image_org_gated");
  });

  it("rejects an invalid body with 400 invalid_agent", async () => {
    const s = await server(fakePool([]));

    const res = await s.inject({
      method: "PUT",
      url: "/api/agent-definitions/fix-ci",
      headers: AUTH,
      payload: { name: "fix-ci", timeout_minutes: 5000 },
    });

    expect(res.statusCode).toBe(400);
    expect(JSON.parse(res.payload).error).toBe("invalid_agent");
  });
});
