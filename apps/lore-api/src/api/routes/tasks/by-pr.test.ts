import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { buildServer } from "../../../server/build-server.js";
import { makePool, makeOctokit, useRateLimitSafeClock, AUTH, LEGACY_TOKEN } from "@re-cinq/lore-server-core/test-helpers/http-mock.js";

vi.mock("../../../platform/github-client.js", () => ({ getOctokit: vi.fn(), getGitHubToken: vi.fn() }));
vi.mock("@re-cinq/lore-shared", () => ({
  redactSecrets: (s: string) => s,
  parseTasks: vi.fn(),
  inferPhaseDependencies: vi.fn(),
  parseTrailers: vi.fn(),
  parseSpecTitle: vi.fn(),
  extractSummary: vi.fn(),
  reassembleSpec: vi.fn(),
}));

import { getOctokit } from "../../../platform/github-client.js";
import { parseTrailers } from "@re-cinq/lore-shared";

const originalEnv = { ...process.env };
const get = (pool: unknown) =>
  buildServer(() => pool as any).inject({ method: "GET", url: "/api/tasks/by-pr/o/r/5", headers: AUTH });

describe("GET /api/tasks/by-pr/:owner/:repo/:n", () => {
  useRateLimitSafeClock();
  beforeEach(() => {
    process.env.LORE_INGEST_TOKEN = LEGACY_TOKEN;
  });
  afterEach(() => {
    process.env = { ...originalEnv };
    vi.clearAllMocks();
  });

  it("returns 503 when pool is null", async () => {
    const res = await get(null);
    expect(res.statusCode).toBe(503);
  });

  it("returns 400 for a non-numeric pr segment", async () => {
    const pool = makePool();
    const res = await buildServer(() => pool as any).inject({ method: "GET", url: "/api/tasks/by-pr/o/r/abc", headers: AUTH });
    expect(res.statusCode).toBe(400);
    expect(res.result).toEqual({ error: "invalid pr number" });
    expect(pool.query).not.toHaveBeenCalled();
  });

  it("resolves via the DB fast path", async () => {
    const pool = makePool();
    pool.query.mockResolvedValue({ rows: [{ id: "t1" }] });
    const res = await get(pool);
    expect(res.result).toEqual({ task_id: "t1", trailer_source: "db" });
  });

  it("resolves from the PR body when the DB misses", async () => {
    const pool = makePool();
    pool.query.mockResolvedValue({ rows: [] });
    const oct = makeOctokit();
    oct.rest.pulls.get.mockResolvedValue({ data: { body: "preamble\nLore-Task: abc-123\n", head: { sha: "h" } } });
    vi.mocked(getOctokit).mockResolvedValue(oct as any);
    const res = await get(pool);
    expect(res.result).toEqual({ task_id: "abc-123", trailer_source: "pr_body" });
  });

  it("resolves from the final commit when the body has no trailer", async () => {
    const pool = makePool();
    pool.query.mockRejectedValue(new Error("db lookup fail"));
    const oct = makeOctokit();
    oct.rest.pulls.get.mockResolvedValue({ data: { body: "nothing here", head: { sha: "h" } } });
    oct.rest.git.getCommit.mockResolvedValue({ data: { message: "commit msg" } });
    vi.mocked(getOctokit).mockResolvedValue(oct as any);
    vi.mocked(parseTrailers).mockReturnValue({ taskId: "xyz" } as any);
    const res = await get(pool);
    expect(res.result).toEqual({ task_id: "xyz", trailer_source: "final_commit" });
  });

  it("returns 404 when no trailer is found anywhere", async () => {
    const pool = makePool();
    pool.query.mockResolvedValue({ rows: [] });
    const oct = makeOctokit();
    oct.rest.pulls.get.mockResolvedValue({ data: { body: "nothing", head: { sha: "h" } } });
    oct.rest.git.getCommit.mockResolvedValue({ data: { message: "no trailer" } });
    vi.mocked(getOctokit).mockResolvedValue(oct as any);
    vi.mocked(parseTrailers).mockReturnValue(null as any);
    const res = await get(pool);
    expect(res.result).toEqual({ error: "no_trailer_found" });
  });

  it("returns 404 when the PR is not found", async () => {
    const pool = makePool();
    pool.query.mockResolvedValue({ rows: [] });
    const oct = makeOctokit();
    oct.rest.pulls.get.mockRejectedValue(Object.assign(new Error("gone"), { status: 404 }));
    vi.mocked(getOctokit).mockResolvedValue(oct as any);
    const res = await get(pool);
    expect(res.result).toEqual({ error: "pr_not_found" });
  });

  it("returns 500 on a non-404 GitHub error", async () => {
    const pool = makePool();
    pool.query.mockResolvedValue({ rows: [] });
    const oct = makeOctokit();
    oct.rest.pulls.get.mockRejectedValue(Object.assign(new Error("boom"), { status: 500 }));
    vi.mocked(getOctokit).mockResolvedValue(oct as any);
    const res = await get(pool);
    expect(res.result).toEqual({ error: "github_api" });
  });

  it("falls through a DB error and resolves from the PR body", async () => {
    const pool = makePool();
    pool.query.mockRejectedValue(new Error("db down"));
    const oct = makeOctokit();
    oct.rest.pulls.get.mockResolvedValue({ data: { body: "Lore-Task: abc-def\n", head: { sha: "h" } } });
    vi.mocked(getOctokit).mockResolvedValue(oct as any);
    const res = await get(pool);
    expect(res.result).toEqual({ task_id: "abc-def", trailer_source: "pr_body" });
  });
});
