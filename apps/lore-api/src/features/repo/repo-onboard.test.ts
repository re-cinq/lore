import { describe, it, expect, vi, beforeEach } from "vitest";
import type { Pool } from "pg";

vi.mock("../webhook/webhook-ensure.js", () => ({
  ensureFloorWebhook: vi.fn(),
}));
vi.mock("@re-cinq/lore-shared", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@re-cinq/lore-shared")>()),
  createPipelineTask: vi.fn(),
}));

import { ensureFloorWebhook } from "../webhook/webhook-ensure.js";
import { createPipelineTask } from "@re-cinq/lore-shared";
import { onboardRepo } from "./repo-onboard.js";

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
