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

function poolReturning(id: string) {
  return { query: vi.fn().mockResolvedValue({ rows: [{ id }] }) };
}

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
    const result = await onboardRepo(poolReturning("repo-1") as any, "o/r");

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
    const result = await onboardRepo(poolReturning("repo-2") as any, "o/r");

    expect(result.repo_id).toBe("repo-2");
    expect(result.task_id).toBe("task-1");
    expect(result.webhook).toEqual({
      ok: false,
      reason: "app_no_webhook_permission",
    });
  });
});
