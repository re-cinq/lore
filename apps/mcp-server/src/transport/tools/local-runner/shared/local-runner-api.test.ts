import { describe, it, expect, afterEach, vi } from "vitest";
import {
  claimTaskBestEffort,
  fetchPendingTaskFromApi,
  resolvePendingTask,
} from "./local-runner-api.js";

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

describe("resolvePendingTask", () => {
  afterEach(() => {
    vi.unstubAllEnvs();
    vi.unstubAllGlobals();
  });

  const cached = {
    id: "c0ffee00-1234",
    description: "d",
    task_type: "runbook",
    target_repo: "re-cinq/lore",
    created_at: "2026-04-03T00:00:00Z",
  };

  it("returns the cached task whose id starts with c0ffee00 without asking the API", async () => {
    const fetchMock = vi.fn();

    vi.stubGlobal("fetch", fetchMock);

    const task = await resolvePendingTask("c0ffee00", [cached]);

    expect({ task, fetched: fetchMock.mock.calls.length }).toEqual({
      task: cached,
      fetched: 0,
    });
  });

  it("returns undefined when the cache misses and no API is configured", async () => {
    vi.stubEnv("LORE_API_URL", "");

    const task = await resolvePendingTask("deadbeef", [cached]);

    expect(task).toBeUndefined();
  });
});

describe("claimTaskBestEffort", () => {
  afterEach(() => {
    vi.unstubAllEnvs();
    vi.unstubAllGlobals();
  });

  it("posts a claim by local-runner for task-1 to /api/task", async () => {
    vi.stubEnv("LORE_API_URL", "http://lore-api.test");
    vi.stubEnv("LORE_INGEST_TOKEN", "test-token");
    const fetchMock = vi.fn().mockResolvedValue({ ok: true });

    vi.stubGlobal("fetch", fetchMock);

    await claimTaskBestEffort("task-1");

    expect(fetchMock.mock.calls[0]).toMatchObject([
      "http://lore-api.test/api/task",
      {
        method: "POST",
        headers: { Authorization: "Bearer test-token" },
        body: JSON.stringify({
          task_id: "task-1",
          action: "claim",
          claimed_by: "local-runner",
        }),
      },
    ]);
  });

  it("posts nothing when no API is configured", async () => {
    vi.stubEnv("LORE_API_URL", "");
    const fetchMock = vi.fn();

    vi.stubGlobal("fetch", fetchMock);

    await claimTaskBestEffort("task-1");

    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("resolves when the claim request throws", async () => {
    vi.stubEnv("LORE_API_URL", "http://lore-api.test");
    vi.stubEnv("LORE_INGEST_TOKEN", "test-token");
    vi.stubGlobal(
      "fetch",
      vi.fn().mockRejectedValue(new Error("network down")),
    );

    await expect(claimTaskBestEffort("task-1")).resolves.toBeUndefined();
  });
});
