import { describe, it, expect, vi, beforeEach } from "vitest";
import type { Pool } from "pg";

vi.mock("../webhook/webhook-ensure.js", () => ({
  ensureFloorWebhook: vi.fn(),
}));
vi.mock("@re-cinq/lore-shared", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@re-cinq/lore-shared")>()),
  createPipelineTask: vi.fn(),
}));
vi.mock("../../platform/github-client.js", () => ({
  getOctokit: vi.fn(),
}));

import { ensureFloorWebhook } from "../webhook/webhook-ensure.js";
import { createPipelineTask } from "@re-cinq/lore-shared";
import { getOctokit } from "../../platform/github-client.js";
import { onboardRepo, fetchRepoContext } from "./repo-onboard.js";

type Row = Record<string, unknown>;

function poolWith({
  repoRows = [] as Row[],
  taskRows = [] as Row[],
  repoId = "repo-1",
} = {}) {
  const query = vi.fn((sql: string) => {
    if (sql.includes("INSERT INTO lore.repos")) {
      return Promise.resolve({ rows: [{ id: repoId }] });
    }

    if (sql.includes("FROM lore.repos")) {
      return Promise.resolve({ rows: repoRows });
    }

    if (sql.includes("pipeline.tasks")) {
      return Promise.resolve({ rows: taskRows });
    }

    return Promise.resolve({ rows: [] });
  });
  const client = { query, release: vi.fn() };
  const pool = { connect: vi.fn().mockResolvedValue(client) };

  return { pool: pool as unknown as Pool, query, client };
}

const callMatching = (query: ReturnType<typeof vi.fn>, needle: string) =>
  query.mock.calls.find((call) => String(call[0]).includes(needle));

const sqlIssued = (query: ReturnType<typeof vi.fn>) =>
  query.mock.calls.map((call) => String(call[0]));

beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(createPipelineTask).mockResolvedValue({
    task_id: "task-1",
    task_type: "onboard",
    status: "pending",
    priority: "normal",
    created_at: "2026-01-01T00:00:00.000Z",
  });
});

describe("onboardRepo", () => {
  it("ensures the Floor webhook for the onboarded repo and returns its outcome", async () => {
    vi.mocked(ensureFloorWebhook).mockResolvedValue({
      ok: true,
      hookId: 7,
      created: true,
    });
    const { pool } = poolWith({ repoId: "repo-1" });
    const result = await onboardRepo(pool, "o/r");

    expect(ensureFloorWebhook).toHaveBeenCalledWith("o/r");
    expect(result).toMatchObject({
      repo_id: "repo-1",
      task_id: "task-1",
      webhook: { ok: true, hookId: 7, created: true },
    });
  });

  it("still completes onboarding when the webhook ensure is skipped", async () => {
    vi.mocked(ensureFloorWebhook).mockResolvedValue({
      ok: false,
      reason: "app_no_webhook_permission",
    });
    const { pool } = poolWith({ repoId: "repo-2" });
    const result = await onboardRepo(pool, "o/r");

    expect(result).toMatchObject({
      repo_id: "repo-2",
      task_id: "task-1",
      webhook: { ok: false, reason: "app_no_webhook_permission" },
    });
  });

  it("takes the per-repo advisory lock before reading the guard state", async () => {
    vi.mocked(ensureFloorWebhook).mockResolvedValue({
      ok: true,
      hookId: 1,
      created: true,
    });
    const { pool, query } = poolWith();

    await onboardRepo(pool, "o/r");

    const issued = sqlIssued(query);

    expect(issued[0]).toBe("BEGIN");
    expect(callMatching(query, "pg_advisory_xact_lock")?.[1]).toEqual([
      "lore.onboard:o/r",
    ]);
    expect(
      issued.findIndex((sql) => sql.includes("pg_advisory_xact_lock")),
    ).toBeLessThan(issued.findIndex((sql) => sql.includes("FROM lore.repos")));
  });

  it("commits the task and the repos row on the one locked connection", async () => {
    vi.mocked(ensureFloorWebhook).mockResolvedValue({
      ok: true,
      hookId: 1,
      created: true,
    });
    const { pool, query, client } = poolWith();

    await onboardRepo(pool, "o/r");

    expect(pool.connect).toHaveBeenCalledTimes(1);
    expect(vi.mocked(createPipelineTask).mock.calls[0][0]).toBe(client);
    expect(sqlIssued(query).at(-1)).toBe("COMMIT");
  });

  it("sends a described task instead of the bare repo name", async () => {
    vi.mocked(ensureFloorWebhook).mockResolvedValue({
      ok: true,
      hookId: 1,
      created: true,
    });
    const { pool } = poolWith();

    await onboardRepo(pool, "o/r");

    expect(vi.mocked(createPipelineTask).mock.calls[0][1]).toMatchObject({
      taskType: "onboard",
      targetRepo: "o/r",
      description: expect.stringContaining("CLAUDE.md"),
    });
  });

  it("rolls back and creates nothing when a write fails", async () => {
    const { pool, query } = poolWith();

    vi.mocked(createPipelineTask).mockRejectedValue(new Error("insert failed"));

    await expect(onboardRepo(pool, "o/r")).rejects.toThrow(
      new Error("insert failed"),
    );

    expect(sqlIssued(query)).toContain("ROLLBACK");
    expect(sqlIssued(query)).not.toContain("COMMIT");
    expect(ensureFloorWebhook).not.toHaveBeenCalled();
  });

  it("blocks an already-onboarded repo without creating a task", async () => {
    const { pool } = poolWith({
      repoRows: [{ onboarding_pr_merged: true, onboarding_pr_url: null }],
    });
    const result = await onboardRepo(pool, "o/r");

    expect(result).toMatchObject({ blocked: "already-onboarded" });
    expect(createPipelineTask).not.toHaveBeenCalled();
    expect(ensureFloorWebhook).not.toHaveBeenCalled();
  });

  it("blocks a repo with an onboard task in flight and names that task", async () => {
    const { pool } = poolWith({ taskRows: [{ id: "task-running" }] });
    const result = await onboardRepo(pool, "o/r");

    expect(result).toMatchObject({
      blocked: "in-flight",
      task_id: "task-running",
    });
    expect(createPipelineTask).not.toHaveBeenCalled();
  });

  it("blocks a repo whose onboarding PR is still open", async () => {
    const { pool } = poolWith({
      repoRows: [
        {
          onboarding_pr_merged: false,
          onboarding_pr_url: "https://github.com/o/r/pull/7",
        },
      ],
    });
    const result = await onboardRepo(pool, "o/r");

    expect(result).toMatchObject({
      blocked: "pr-open",
      error: expect.stringContaining("pull/7"),
    });
  });

  it("blocks reonboard while the onboarding PR is still open", async () => {
    const { pool } = poolWith({
      repoRows: [
        {
          onboarding_pr_merged: false,
          onboarding_pr_url: "https://github.com/o/r/pull/7",
        },
      ],
    });
    const result = await onboardRepo(pool, "o/r", { reonboard: true });

    expect(result).toMatchObject({ blocked: "pr-open" });
    expect(createPipelineTask).not.toHaveBeenCalled();
  });

  it("creates a task for an onboarded repo when reonboard is requested", async () => {
    vi.mocked(ensureFloorWebhook).mockResolvedValue({
      ok: true,
      hookId: 1,
      created: true,
    });
    const { pool } = poolWith({
      repoRows: [{ onboarding_pr_merged: true, onboarding_pr_url: null }],
    });
    const result = await onboardRepo(pool, "o/r", { reonboard: true });

    expect(result).toMatchObject({ task_id: "task-1" });
  });

  it("still blocks reonboard while an onboard task is in flight", async () => {
    const { pool } = poolWith({
      repoRows: [{ onboarding_pr_merged: true, onboarding_pr_url: null }],
      taskRows: [{ id: "task-running" }],
    });
    const result = await onboardRepo(pool, "o/r", { reonboard: true });

    expect(result).toMatchObject({ blocked: "in-flight" });
    expect(createPipelineTask).not.toHaveBeenCalled();
  });
});

type ContentRoute =
  | { kind: "file"; content: string }
  | {
      kind: "dir";
      entries: Array<{ name: string; path: string; type: string }>;
    }
  | { kind: "error"; status?: number };

function octokitFake(routes: Record<string, ContentRoute>) {
  const getContent = vi.fn(async ({ path }: { path: string }) => {
    const route = routes[path] ?? { kind: "error" as const, status: 404 };

    if (route.kind === "error") {
      const err = new Error("not found") as Error & { status?: number };

      err.status = route.status;
      throw err;
    }

    if (route.kind === "dir") {
      return { data: route.entries };
    }

    return {
      data: {
        type: "file",
        content: Buffer.from(route.content).toString("base64"),
      },
    };
  });

  return { rest: { repos: { getContent } } };
}

describe("fetchRepoContext", () => {
  beforeEach(() => {
    vi.mocked(getOctokit).mockReset();
  });

  it("throws for a full_name without an owner/repo slash", async () => {
    await expect(fetchRepoContext("no-slash")).rejects.toThrow(
      'Invalid repo full_name: "no-slash". Expected "owner/repo" format.',
    );
  });

  it("lists the top-level tree and decodes present key files, skipping 404s", async () => {
    vi.mocked(getOctokit).mockResolvedValue(
      octokitFake({
        "": {
          kind: "dir",
          entries: [
            { name: "README.md", path: "README.md", type: "file" },
            { name: "src", path: "src", type: "dir" },
          ],
        },
        "README.md": { kind: "file", content: "# Hi" },
        "AGENTS.md": { kind: "error", status: 500 },
      }) as unknown as Awaited<ReturnType<typeof getOctokit>>,
    );

    const result = await fetchRepoContext("o/r");

    expect(result.tree).toEqual(["README.md", "src"]);
    expect(result.files).toEqual({ "README.md": "# Hi" });
    expect(result.samples).toEqual({});
  });

  it("returns an empty tree when the top-level listing fails", async () => {
    vi.mocked(getOctokit).mockResolvedValue(
      octokitFake({
        "": { kind: "error", status: 500 },
      }) as unknown as Awaited<ReturnType<typeof getOctokit>>,
    );

    const result = await fetchRepoContext("o/r");

    expect(result.tree).toEqual([]);
  });

  it("collects up to 3 samples across dirs, filters to file entries, and stops mid-directory once full", async () => {
    const longFile = Array.from({ length: 250 }, (_, i) => `line${i}`).join(
      "\n",
    );
    const octokit = octokitFake({
      src: {
        kind: "dir",
        entries: [
          { name: "a.ts", path: "src/a.ts", type: "file" },
          { name: "sub", path: "src/sub", type: "dir" },
          { name: "b.ts", path: "src/b.ts", type: "file" },
        ],
      },
      "src/a.ts": { kind: "file", content: longFile },
      "src/b.ts": { kind: "file", content: "short content" },
      lib: {
        kind: "dir",
        entries: [
          { name: "c.ts", path: "lib/c.ts", type: "file" },
          { name: "d.ts", path: "lib/d.ts", type: "file" },
        ],
      },
      "lib/c.ts": { kind: "file", content: "c body" },
      "lib/d.ts": { kind: "file", content: "d body" },
    });

    vi.mocked(getOctokit).mockResolvedValue(
      octokit as unknown as Awaited<ReturnType<typeof getOctokit>>,
    );

    const result = await fetchRepoContext("o/r");

    expect(result.samples).toEqual({
      "src/a.ts": longFile.split("\n").slice(0, 200).join("\n"),
      "src/b.ts": "short content",
      "lib/c.ts": "c body",
    });
    const requestedPaths = octokit.rest.repos.getContent.mock.calls.map(
      (call) => call[0].path,
    );

    expect(requestedPaths).not.toContain("src/sub");
    expect(requestedPaths).not.toContain("lib/d.ts");
    expect(requestedPaths).not.toContain("cmd");
  });

  it("skips a sample dir on 404 and on any other listing error, continuing to the next dir", async () => {
    vi.mocked(getOctokit).mockResolvedValue(
      octokitFake({
        src: { kind: "error", status: 404 },
        lib: { kind: "error", status: 500 },
        cmd: {
          kind: "dir",
          entries: [{ name: "e.ts", path: "cmd/e.ts", type: "file" }],
        },
        "cmd/e.ts": { kind: "file", content: "e body" },
      }) as unknown as Awaited<ReturnType<typeof getOctokit>>,
    );

    const result = await fetchRepoContext("o/r");

    expect(result.samples).toEqual({ "cmd/e.ts": "e body" });
  });

  it("skips a sample entry whose content fetch fails, keeping the other entries", async () => {
    vi.mocked(getOctokit).mockResolvedValue(
      octokitFake({
        src: {
          kind: "dir",
          entries: [
            { name: "bad.ts", path: "src/bad.ts", type: "file" },
            { name: "good.ts", path: "src/good.ts", type: "file" },
          ],
        },
        "src/bad.ts": { kind: "error", status: 500 },
        "src/good.ts": { kind: "file", content: "good body" },
      }) as unknown as Awaited<ReturnType<typeof getOctokit>>,
    );

    const result = await fetchRepoContext("o/r");

    expect(result.samples).toEqual({ "src/good.ts": "good body" });
  });
});
