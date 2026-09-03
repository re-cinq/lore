import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { buildServer } from "../../../server/build-server.js";
import {
  makePool,
  useRateLimitSafeClock,
  AUTH,
  LEGACY_TOKEN,
} from "@re-cinq/lore-server-core/test-helpers/http-mock.js";

vi.mock(
  "@re-cinq/lore-server-core/features/pipeline/tasks.js",
  async (orig) => ({
    ...(await orig<
      typeof import("@re-cinq/lore-server-core/features/pipeline/tasks.js")
    >()),
    syncTasksToDb: vi.fn(),
    getReadyTasks: vi.fn(),
    claimTask: vi.fn(),
    completeTask: vi.fn(),
  }),
);

import {
  syncTasksToDb,
  getReadyTasks,
  claimTask,
  completeTask,
} from "@re-cinq/lore-server-core/features/pipeline/tasks.js";

const originalEnv = { ...process.env };
const server = (pool: unknown = makePool()) => buildServer(() => pool as never);
const get = (url: string, pool?: unknown) =>
  server(pool).inject({ method: "GET", url, headers: AUTH });
const post = (url: string, payload: unknown, pool?: unknown) =>
  server(pool).inject({
    method: "POST",
    url,
    headers: AUTH,
    payload: JSON.stringify(payload),
  });

const TASKS_MD = `## Phase 1\n\n- [ ] T001 Wire the widget\n- [ ] T002 [P] Paint it\n`;

describe("spec-task DAG routes", () => {
  useRateLimitSafeClock();
  beforeEach(() => {
    process.env.LORE_INGEST_TOKEN = LEGACY_TOKEN;
  });
  afterEach(() => {
    process.env = { ...originalEnv };
    vi.clearAllMocks();
  });

  describe("POST /api/spec-tasks/sync", () => {
    it("parses the markdown and reports parsed, synced and created counts", async () => {
      vi.mocked(syncTasksToDb).mockResolvedValue({ synced: 2, created: 1 });
      const res = await post("/api/spec-tasks/sync", {
        repo: "o/r",
        spec_slug: "widgets",
        tasks_markdown: TASKS_MD,
      });

      expect(res.result).toEqual({ parsed: 2, synced: 2, created: 1 });
    });

    it("passes the parsed tasks, repo and slug to the syncer", async () => {
      vi.mocked(syncTasksToDb).mockResolvedValue({ synced: 2, created: 2 });
      await post("/api/spec-tasks/sync", {
        repo: "o/r",
        spec_slug: "widgets",
        tasks_markdown: TASKS_MD,
      });

      const [, repo, slug, parsed] = vi.mocked(syncTasksToDb).mock.calls[0];

      expect([repo, slug]).toEqual(["o/r", "widgets"]);
      expect(parsed).toHaveLength(2);
    });

    it("reports parsed:0 without syncing when the markdown has no tasks", async () => {
      const res = await post("/api/spec-tasks/sync", {
        repo: "o/r",
        spec_slug: "widgets",
        tasks_markdown: "# Nothing to do here",
      });

      expect(res.result).toEqual({ parsed: 0, synced: 0, created: 0 });
      expect(syncTasksToDb).not.toHaveBeenCalled();
    });

    it("returns 400 for a repo that is not owner/name", async () => {
      const res = await post("/api/spec-tasks/sync", {
        repo: "not-a-repo",
        spec_slug: "widgets",
        tasks_markdown: TASKS_MD,
      });

      expect(res.statusCode).toBe(400);
    });
  });

  describe("GET /api/spec-tasks/ready", () => {
    it("returns the dependency-ready tasks for the repo", async () => {
      const tasks = [
        {
          id: "t1",
          description: "wire",
          context_bundle: { spec_task_id: "T001" },
        },
      ];

      vi.mocked(getReadyTasks).mockResolvedValue(tasks as never);
      const res = await get("/api/spec-tasks/ready?repo=o/r");

      expect(res.result).toEqual({ tasks });
      expect(vi.mocked(getReadyTasks).mock.calls[0][1]).toBe("o/r");
    });

    it("returns 400 when repo is missing", async () => {
      const res = await get("/api/spec-tasks/ready");

      expect(res.statusCode).toBe(400);
    });
  });

  describe("POST /api/spec-tasks/claim", () => {
    it("reports claimed:true and the claiming agent", async () => {
      vi.mocked(claimTask).mockResolvedValue(true);
      const res = await post("/api/spec-tasks/claim", {
        task_id: "t1",
        agent_id: "agent-7",
      });

      expect(res.result).toEqual({
        claimed: true,
        task_id: "t1",
        agent_id: "agent-7",
      });
    });

    it("reports claimed:false when the task is already taken", async () => {
      vi.mocked(claimTask).mockResolvedValue(false);
      const res = await post("/api/spec-tasks/claim", {
        task_id: "t1",
        agent_id: "agent-7",
      });

      expect(res.result).toMatchObject({ claimed: false });
    });
  });

  describe("POST /api/spec-tasks/complete", () => {
    it("returns the completion flag and newly unblocked dependents", async () => {
      vi.mocked(completeTask).mockResolvedValue({
        completed: true,
        unblocked: ["T002"],
      });
      const res = await post("/api/spec-tasks/complete", { task_id: "t1" });

      expect(res.result).toEqual({ completed: true, unblocked: ["T002"] });
    });
  });

  it("returns 503 for every spec-task route when the pool is null", async () => {
    const responses = await Promise.all([
      get("/api/spec-tasks/ready?repo=o/r", null),
      post("/api/spec-tasks/claim", { task_id: "t1", agent_id: "a" }, null),
      post("/api/spec-tasks/complete", { task_id: "t1" }, null),
      post(
        "/api/spec-tasks/sync",
        { repo: "o/r", spec_slug: "s", tasks_markdown: TASKS_MD },
        null,
      ),
    ]);

    expect(responses.map((r) => r.statusCode)).toEqual([503, 503, 503, 503]);
  });
});
