import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";

const fakeSettings = { record: vi.fn(), rawSettings: vi.fn() };

vi.mock("../../../outbound/project-boot.js", () => ({
  projectFor: vi.fn(async () => ({ settings: fakeSettings })),
}));

import { buildServer } from "../../../app/build-server.js";
import {
  makePool,
  AUTH,
  LEGACY_TOKEN,
} from "@re-cinq/lore-server-core/test-helpers/http-mock.js";

const originalEnv = { ...process.env };

describe("org settings + pack.sync", () => {
  beforeEach(() => {
    process.env.LORE_INGEST_TOKEN = LEGACY_TOKEN;
  });
  afterEach(() => {
    process.env = { ...originalEnv };
    vi.clearAllMocks();
  });

  it("fetches the pack.sync key correctly parsed when present", async () => {
    const pool = makePool();
    const mockJson = {
      repo: "acme/lore-pack",
      ref: "main",
      commit: "a1b2c3d",
      applied_at: new Date("2026-11-17T00:00:00.000Z").toISOString(),
      agent_count: 5,
      line_count: 120,
      extra_count: 2,
      refused_files: [{ path: "bad.txt", reason: "invalid" }],
      agents: ["acme-triage"],
      pipelines: ["acme-release"],
      error: null,
      error_at: null,
    };

    pool.query
      .mockResolvedValueOnce({
        rows: [
          {
            key: "pack.sync",
            value: JSON.stringify(mockJson),
            updated_at: "2026-11-17T00:00:00.000Z",
          },
        ],
      })
      .mockResolvedValueOnce({ rows: [{ count: 1 }] });

    const server = buildServer(() => pool as never);
    const res = await server.inject({
      method: "GET",
      url: "/api/settings",
      headers: AUTH,
    });

    expect(res.statusCode).toBe(200);
    const result = res.result as {
      settings: { key: string; value: string }[];
      pack_sync: unknown;
    };
    const packSync = result.settings.find((s) => s.key === "pack.sync");

    expect(packSync?.value).toBe(JSON.stringify(mockJson));
    expect(result.pack_sync).toEqual({
      ...mockJson,
      skill_count: 0,
      skills: [],
    });
  });
});
