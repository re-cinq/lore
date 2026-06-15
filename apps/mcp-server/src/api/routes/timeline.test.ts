import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { handleApiRoute } from "../routes.js";
import { makeReq, makeRes, makePool, makeOctokit, useRateLimitSafeClock, AUTH, LEGACY_TOKEN } from "../../test-helpers/http-mock.js";

vi.mock("../../platform/github-client.js", () => ({ getOctokit: vi.fn(), getGitHubToken: vi.fn() }));
vi.mock("@re-cinq/lore-shared", () => ({
  redactSecrets: (s: string) => s,
  parseTasks: vi.fn(),
  inferPhaseDependencies: vi.fn(),
  parseTrailers: vi.fn(),
  parseSpecTitle: vi.fn(),
  extractSummary: vi.fn(),
  reassembleSpec: vi.fn(),
}));

import { getOctokit } from "../../platform/github-client.js";
import { parseTrailers } from "@re-cinq/lore-shared";

const originalEnv = { ...process.env };

describe("GET /api/tasks/:id/timeline", () => {
  useRateLimitSafeClock();
  beforeEach(() => {
    process.env.LORE_INGEST_TOKEN = LEGACY_TOKEN;
  });
  afterEach(() => {
    process.env = { ...originalEnv };
    vi.clearAllMocks();
  });

  const taskRow = (over: Record<string, unknown> = {}) => ({
    target_repo: "o/r",
    target_branch: "b",
    pr_number: 5,
    pr_url: "u",
    status: "running",
    created_at: new Date(Date.now() - 60_000),
    ...over,
  });
  function timelinePool(taskResult: any, leaseResult: any = { rows: [] }) {
    const pool = makePool();
    pool.query.mockImplementation((sql: string) => {
      if (sql.includes("task_leases")) return Promise.resolve(leaseResult);
      return Promise.resolve(taskResult);
    });
    return pool;
  }

  it("returns 503 when pool is null", async () => {
    const res = makeRes();
    await handleApiRoute(makeReq({ url: "/api/tasks/t1/timeline", headers: AUTH }), res, null);
    expect(res.statusCode).toBe(503);
  });
  it("returns 404 when the path fails the stricter handler regex", async () => {
    const res = makeRes();
    await handleApiRoute(makeReq({ url: "/api/tasks/a?b/timeline", headers: AUTH }), res, makePool() as any);
    expect(res.statusCode).toBe(404);
    expect(res.json).toEqual({ error: "not found" });
  });
  it("returns 500 when the task lookup throws", async () => {
    const pool = makePool();
    pool.query.mockRejectedValue(new Error("db"));
    const res = makeRes();
    await handleApiRoute(makeReq({ url: "/api/tasks/t1/timeline", headers: AUTH }), res, pool as any);
    expect(res.statusCode).toBe(500);
  });
  it("returns 404 when the task does not exist", async () => {
    const pool = timelinePool({ rows: [] });
    const res = makeRes();
    await handleApiRoute(makeReq({ url: "/api/tasks/t1/timeline", headers: AUTH }), res, pool as any);
    expect(res.json).toEqual({ error: "task_not_found" });
  });
  it("returns pending:no_branch when the task has no branch", async () => {
    const pool = timelinePool({ rows: [taskRow({ target_repo: null, target_branch: null })] });
    const res = makeRes();
    await handleApiRoute(makeReq({ url: "/api/tasks/t1/timeline", headers: AUTH }), res, pool as any);
    expect(res.json).toMatchObject({ pending: "no_branch", commits: [] });
  });
  it("builds the timeline with stage commits, merged PR, and held lease", async () => {
    const oct = makeOctokit();
    oct.rest.repos.listCommits.mockResolvedValue({
      data: [
        { sha: "s2", commit: { message: "stage two has-trailer", committer: { date: new Date(Date.now() - 10_000).toISOString() } } },
        { sha: "s1", commit: { message: "no markers here", committer: { date: new Date(Date.now() - 20_000).toISOString() } } },
      ],
    });
    oct.rest.pulls.get.mockResolvedValue({ data: { merged: true, state: "closed" } });
    vi.mocked(getOctokit).mockResolvedValue(oct as any);
    vi.mocked(parseTrailers).mockImplementation((msg: string) =>
      msg.includes("has-trailer") ? ({ stage: "impl", iteration: 1, extras: { "Lore-Outcome": "success" } } as any) : null,
    );
    const pool = timelinePool(
      { rows: [taskRow()] },
      { rows: [{ holder: "agent-1", expires_at: new Date(Date.now() + 60_000) }] },
    );
    const res = makeRes();
    await handleApiRoute(makeReq({ url: "/api/tasks/t1/timeline", headers: AUTH }), res, pool as any);
    expect(res.json).toMatchObject({
      pr_state: "merged",
      current_stage: "impl",
      lease: { held: true, holder: "agent-1" },
    });
    expect(res.json.commits).toHaveLength(1);
    expect(typeof res.json.commits[0].duration_ms).toBe("number");
  });
  it("tolerates a failing PR fetch and empty lease, no trailers", async () => {
    const oct = makeOctokit();
    oct.rest.repos.listCommits.mockResolvedValue({
      data: [{ sha: "s1", commit: { message: "plain", committer: { date: null } } }],
    });
    oct.rest.pulls.get.mockRejectedValue(new Error("pr gone"));
    vi.mocked(getOctokit).mockResolvedValue(oct as any);
    vi.mocked(parseTrailers).mockReturnValue(null as any);
    const pool = timelinePool({ rows: [taskRow()] }, { rows: [] });
    const res = makeRes();
    await handleApiRoute(makeReq({ url: "/api/tasks/t1/timeline", headers: AUTH }), res, pool as any);
    expect(res.json).toMatchObject({ pr_state: null, current_stage: null, lease: { held: false } });
  });
  it("skips the PR fetch when there is no pr_number", async () => {
    const oct = makeOctokit();
    oct.rest.repos.listCommits.mockResolvedValue({ data: [] });
    vi.mocked(getOctokit).mockResolvedValue(oct as any);
    const pool = timelinePool({ rows: [taskRow({ pr_number: null })] });
    const res = makeRes();
    await handleApiRoute(makeReq({ url: "/api/tasks/t1/timeline", headers: AUTH }), res, pool as any);
    expect(oct.rest.pulls.get).not.toHaveBeenCalled();
    expect(res.statusCode).toBe(200);
  });
  it("covers commit field fallbacks (null date, no extras, non-finite duration)", async () => {
    const oct = makeOctokit();
    oct.rest.repos.listCommits.mockResolvedValue({
      data: [
        { sha: "a", commit: { message: "a has-trailer", committer: { date: null } } },
        { sha: "b", commit: { message: "b has-trailer", committer: { date: "not-a-date" } } },
      ],
    });
    vi.mocked(getOctokit).mockResolvedValue(oct as any);
    vi.mocked(parseTrailers).mockReturnValue({ stage: "s", iteration: 0 } as any);
    const pool = timelinePool({ rows: [taskRow({ pr_number: null })] });
    const res = makeRes();
    await handleApiRoute(makeReq({ url: "/api/tasks/t1/timeline", headers: AUTH }), res, pool as any);
    expect(res.json.commits).toHaveLength(2);
    expect(res.json.commits.every((c: any) => c.outcome === "success" && c.extras === undefined)).toBe(true);
    expect(res.json.commits.some((c: any) => c.duration_ms === null)).toBe(true);
  });
  it("returns branch_deleted when GitHub 404s", async () => {
    const oct = makeOctokit();
    oct.rest.repos.listCommits.mockRejectedValue(Object.assign(new Error("gone"), { status: 404 }));
    vi.mocked(getOctokit).mockResolvedValue(oct as any);
    const pool = timelinePool({ rows: [taskRow()] });
    const res = makeRes();
    await handleApiRoute(makeReq({ url: "/api/tasks/t1/timeline", headers: AUTH }), res, pool as any);
    expect(res.json).toMatchObject({ branch_deleted: true });
  });
  it("returns 500 on a non-404 GitHub error", async () => {
    const oct = makeOctokit();
    oct.rest.repos.listCommits.mockRejectedValue(Object.assign(new Error("boom"), { status: 500 }));
    vi.mocked(getOctokit).mockResolvedValue(oct as any);
    const pool = timelinePool({ rows: [taskRow()] });
    const res = makeRes();
    await handleApiRoute(makeReq({ url: "/api/tasks/t1/timeline", headers: AUTH }), res, pool as any);
    expect(res.json).toEqual({ error: "github_api" });
  });
  it("tolerates a failing lease query", async () => {
    const oct = makeOctokit();
    oct.rest.repos.listCommits.mockResolvedValue({ data: [] });
    oct.rest.pulls.get.mockResolvedValue({ data: { merged: false, state: "open" } });
    vi.mocked(getOctokit).mockResolvedValue(oct as any);
    const pool = makePool();
    pool.query.mockImplementation((sql: string) => {
      if (sql.includes("task_leases")) return Promise.reject(new Error("no table"));
      return Promise.resolve({ rows: [taskRow()] });
    });
    const res = makeRes();
    await handleApiRoute(makeReq({ url: "/api/tasks/t1/timeline", headers: AUTH }), res, pool as any);
    expect(res.json).toMatchObject({ pr_state: "open", lease: null });
  });
});
