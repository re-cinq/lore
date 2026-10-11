import { describe, it, expect, afterEach, vi } from "vitest";
import { fetchPendingTaskFromApi } from "./local-runner-tools.local.js";

describe("fetchPendingTaskFromApi", () => {
  afterEach(() => {
    delete process.env.LORE_API_URL;
    delete process.env.LORE_INGEST_TOKEN;
    vi.unstubAllGlobals();
  });

  it("returns undefined without fetching when the API URL or token is not configured", async () => {
    const fetchMock = vi.fn();

    vi.stubGlobal("fetch", fetchMock);

    const task = await fetchPendingTaskFromApi("task-1");

    expect(task).toBeUndefined();
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("returns undefined when the API responds non-ok", async () => {
    process.env.LORE_API_URL = "http://lore-api.test";
    process.env.LORE_INGEST_TOKEN = "test-token";
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue({ ok: false }));

    const task = await fetchPendingTaskFromApi("task-1");

    expect(task).toBeUndefined();
  });

  it("returns undefined when the fetched task is not pending", async () => {
    process.env.LORE_API_URL = "http://lore-api.test";
    process.env.LORE_INGEST_TOKEN = "test-token";
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue({
        ok: true,
        json: async () => ({
          id: "task-1",
          status: "completed",
          description: "d",
          task_type: "general",
          target_repo: "re-cinq/lore",
          created_at: "2026-04-03T00:00:00Z",
        }),
      }),
    );

    const task = await fetchPendingTaskFromApi("task-1");

    expect(task).toBeUndefined();
  });

  it("returns the pending task's fields on success", async () => {
    process.env.LORE_API_URL = "http://lore-api.test";
    process.env.LORE_INGEST_TOKEN = "test-token";
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue({
        ok: true,
        json: async () => ({
          id: "task-1",
          status: "pending",
          description: "do the thing",
          task_type: "general",
          target_repo: "re-cinq/lore",
          created_at: "2026-04-03T00:00:00Z",
          issue_number: 42,
        }),
      }),
    );

    const task = await fetchPendingTaskFromApi("task-1");

    expect(task).toEqual({
      id: "task-1",
      description: "do the thing",
      task_type: "general",
      target_repo: "re-cinq/lore",
      issue_number: 42,
      created_at: "2026-04-03T00:00:00Z",
    });
  });

  it("returns undefined when the request throws", async () => {
    process.env.LORE_API_URL = "http://lore-api.test";
    process.env.LORE_INGEST_TOKEN = "test-token";
    vi.stubGlobal(
      "fetch",
      vi.fn().mockRejectedValue(new Error("network down")),
    );

    const task = await fetchPendingTaskFromApi("task-1");

    expect(task).toBeUndefined();
  });
});
