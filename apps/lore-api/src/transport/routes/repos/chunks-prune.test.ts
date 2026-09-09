import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { buildServer } from "../../../app/build-server.js";
import {
  makePool,
  useRateLimitSafeClock,
  AUTH,
  LEGACY_TOKEN,
} from "@re-cinq/lore-server-core/test-helpers/http-mock.js";

vi.mock("../../../work/chunks/prune-orphans.js", () => ({
  pruneOrphanChunks: vi.fn(),
}));

import { pruneOrphanChunks } from "../../../work/chunks/prune-orphans.js";

const originalEnv = { ...process.env };

const post = (body: unknown) =>
  buildServer(() => makePool() as any).inject({
    method: "POST",
    url: "/api/repos/re-cinq/lore/chunks/prune",
    headers: AUTH,
    payload: JSON.stringify(body),
  });

describe("POST /api/repos/{owner}/{repo}/chunks/prune", () => {
  useRateLimitSafeClock();
  beforeEach(() => {
    process.env.LORE_INGEST_TOKEN = LEGACY_TOKEN;
    vi.mocked(pruneOrphanChunks).mockResolvedValue({
      schema: "platform",
      deleted_paths: ["apps/lore-api/src/api/routes/features/features.test.ts"],
      deleted_chunks: 3,
    });
  });
  afterEach(() => {
    process.env = { ...originalEnv };
    vi.clearAllMocks();
  });

  it("prunes re-cinq/lore against the 2 posted present paths and returns what was deleted", async () => {
    const res = await post({ present_paths: ["CLAUDE.md", "specs/x/spec.md"] });

    expect({
      status: res.statusCode,
      body: res.result,
      args: vi.mocked(pruneOrphanChunks).mock.calls[0].slice(1),
    }).toEqual({
      status: 200,
      body: {
        schema: "platform",
        deleted_paths: [
          "apps/lore-api/src/api/routes/features/features.test.ts",
        ],
        deleted_chunks: 3,
      },
      args: ["re-cinq/lore", ["CLAUDE.md", "specs/x/spec.md"]],
    });
  });

  it("accepts a 3MB present_paths body, above the 1MB server default, so a large tree is not truncated into a mass delete", async () => {
    const wideTree = Array.from(
      { length: 60_000 },
      (_, index) => `apps/lore-api/src/very/long/path/segment/${index}.ts`,
    );
    const res = await post({ present_paths: wideTree });

    expect({
      status: res.statusCode,
      bodyBytes: JSON.stringify({ present_paths: wideTree }).length > 3_000_000,
    }).toEqual({ status: 200, bodyBytes: true });
  });

  it("refuses an empty present_paths with 400 before touching the store, so an empty tree can never wipe a repo", async () => {
    const res = await post({ present_paths: [] });

    expect({
      status: res.statusCode,
      calls: vi.mocked(pruneOrphanChunks).mock.calls.length,
    }).toEqual({ status: 400, calls: 0 });
  });
});
