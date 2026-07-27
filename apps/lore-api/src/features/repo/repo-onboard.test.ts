import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("../webhook/webhook-ensure.js", () => ({
  ensureFloorWebhook: vi.fn(),
}));
vi.mock("@re-cinq/lore-server-core/features/pipeline/pipeline.js", () => ({
  createTask: vi.fn(),
}));

import { ensureFloorWebhook } from "../webhook/webhook-ensure.js";
import { createTask } from "@re-cinq/lore-server-core/features/pipeline/pipeline.js";
import { onboardRepo } from "./repo-onboard.js";

/**
 * A pool whose client answers the guard reads in order — BEGIN, the advisory
 * lock, the lore.repos lookup, the in-flight onboard-task lookup — then the
 * repos upsert.
 */
function poolWith({
  repoRows = [] as Record<string, unknown>[],
  taskRows = [] as Record<string, unknown>[],
  repoId = "repo-1",
} = {}) {
  const query = vi
    .fn()
    .mockResolvedValueOnce({ rows: [] }) // BEGIN
    .mockResolvedValueOnce({ rows: [] }) // pg_advisory_xact_lock
    .mockResolvedValueOnce({ rows: repoRows })
    .mockResolvedValueOnce({ rows: taskRows })
    .mockResolvedValue({ rows: [{ id: repoId }] });
  const client = { query, release: vi.fn() };

  return { pool: { connect: vi.fn().mockResolvedValue(client) }, query };
}

const sqlOf = (query: ReturnType<typeof vi.fn>, call: number) =>
  String(query.mock.calls[call][0]);

beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(createTask).mockResolvedValue({ task_id: "task-1" } as any);
});

describe("onboardRepo", () => {
  it("ensures the Floor webhook for the onboarded repo and returns its outcome", async () => {
    vi.mocked(ensureFloorWebhook).mockResolvedValue({
      ok: true,
      hookId: 7,
      created: true,
    });
    const { pool } = poolWith({ repoId: "repo-1" });
    const result = await onboardRepo(pool as any, "o/r");

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
    const result = await onboardRepo(pool as any, "o/r");

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

    await onboardRepo(pool as any, "o/r");

    expect(sqlOf(query, 1)).toContain("pg_advisory_xact_lock");
    expect(query.mock.calls[1][1]).toEqual(["lore.onboard:o/r"]);
  });

  it("sends a described task instead of the bare repo name", async () => {
    vi.mocked(ensureFloorWebhook).mockResolvedValue({
      ok: true,
      hookId: 1,
      created: true,
    });
    const { pool } = poolWith();

    await onboardRepo(pool as any, "o/r");

    const [description, taskType] = vi.mocked(createTask).mock.calls[0];

    expect(taskType).toBe("onboard");
    expect(description).toContain("o/r");
    expect(description).toContain("CLAUDE.md");
  });

  it("blocks an already-onboarded repo without creating a task", async () => {
    const { pool } = poolWith({
      repoRows: [{ onboarding_pr_merged: true, onboarding_pr_url: null }],
    });
    const result = await onboardRepo(pool as any, "o/r");

    expect(result).toMatchObject({ blocked: "already-onboarded" });
    expect(createTask).not.toHaveBeenCalled();
    expect(ensureFloorWebhook).not.toHaveBeenCalled();
  });

  it("blocks a repo with an onboard task in flight and names that task", async () => {
    const { pool } = poolWith({ taskRows: [{ id: "task-running" }] });
    const result = await onboardRepo(pool as any, "o/r");

    expect(result).toMatchObject({
      blocked: "in-flight",
      task_id: "task-running",
    });
    expect(createTask).not.toHaveBeenCalled();
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
    const result = await onboardRepo(pool as any, "o/r");

    expect(result).toMatchObject({
      blocked: "pr-open",
      error: expect.stringContaining("pull/7"),
    });
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
    const result = await onboardRepo(pool as any, "o/r", { reonboard: true });

    expect(result).toMatchObject({ task_id: "task-1" });
  });

  it("still blocks reonboard while an onboard task is in flight", async () => {
    const { pool } = poolWith({
      repoRows: [{ onboarding_pr_merged: true, onboarding_pr_url: null }],
      taskRows: [{ id: "task-running" }],
    });
    const result = await onboardRepo(pool as any, "o/r", { reonboard: true });

    expect(result).toMatchObject({ blocked: "in-flight" });
    expect(createTask).not.toHaveBeenCalled();
  });
});
