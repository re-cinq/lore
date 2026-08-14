// @vitest-environment node
//
// The paths and body field names ARE the contract with lore-api. These calls
// replace SQL the web UI used to run against pipeline.tasks itself, so a rename
// on either side is now a 404 rather than a compile error — which is exactly
// what these assertions are here to catch.

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

vi.mock("server-only", () => ({}));

const {
  createTask,
  getTask,
  cancelTask,
  runTaskNow,
  getTaskRuns,
  getTaskLogs,
  getRepoTasks,
  getTaskStats,
  getAgentActivity,
  getTaskRuntime,
  getAuditLog,
} = await import("./tasks");

let fetchMock: ReturnType<typeof vi.fn>;

beforeEach(() => {
  vi.clearAllMocks();
  process.env.LORE_API_URL = "http://api:3000";
  process.env.LORE_ADMIN_TOKEN = "admin";
  fetchMock = vi.fn().mockResolvedValue(new Response(JSON.stringify({})));
  vi.stubGlobal("fetch", fetchMock);
});

afterEach(() => {
  vi.unstubAllGlobals();
  delete process.env.LORE_ADMIN_TOKEN;
});

const url = () => fetchMock.mock.calls[0][0];
const init = () => fetchMock.mock.calls[0][1];
const body = () => JSON.parse(init().body as string);

describe("createTask", () => {
  it("posts the description and returns the new task id", async () => {
    fetchMock.mockResolvedValue(
      new Response(JSON.stringify({ task_id: "t9", status: "pending" })),
    );

    const result = await createTask({
      description: "do the thing",
      taskType: "general",
      targetRepo: "re-cinq/lore",
      priority: "immediate",
    });

    expect(url()).toEqual("http://api:3000/api/task");
    expect(body()).toEqual({
      description: "do the thing",
      task_type: "general",
      target_repo: "re-cinq/lore",
      priority: "immediate",
    });
    expect(result).toMatchObject({ status: "ok", data: { task_id: "t9" } });
  });

  it("omits the optional fields it was not given", async () => {
    await createTask({ description: "bare" });

    expect(body()).toEqual({ description: "bare" });
  });
});

describe("getTask", () => {
  it("reads the task by id", async () => {
    await getTask("t1");

    expect(url()).toEqual("http://api:3000/api/task/t1");
    expect(init().method).toEqual("GET");
  });

  it("encodes an id carrying a slash", async () => {
    await getTask("a/b");

    expect(url()).toEqual("http://api:3000/api/task/a%2Fb");
  });

  it("returns the task on 200", async () => {
    fetchMock.mockResolvedValue(
      new Response(JSON.stringify({ id: "t1", status: "pending" })),
    );

    expect(await getTask("t1")).toEqual({
      status: "ok",
      data: { id: "t1", status: "pending" },
    });
  });
});

describe("cancelTask", () => {
  it("posts the cancel action", async () => {
    await cancelTask("t1");

    expect(url()).toEqual("http://api:3000/api/task");
    expect(init().method).toEqual("POST");
    expect(body()).toEqual({ action: "cancel", task_id: "t1" });
  });

  it("carries the upstream refusal and its status", async () => {
    fetchMock.mockResolvedValue(
      new Response(
        JSON.stringify({ error: "Cannot cancel task in merged state" }),
        {
          status: 409,
        },
      ),
    );

    expect(await cancelTask("t1")).toMatchObject({
      status: "error",
      message: "Cannot cancel task in merged state",
      code: 409,
    });
  });
});

describe("runTaskNow", () => {
  it("posts the run-now action", async () => {
    await runTaskNow("t1");

    expect(url()).toEqual("http://api:3000/api/task");
    expect(body()).toEqual({ action: "run-now", task_id: "t1" });
  });
});

describe("getTaskRuns", () => {
  it("reads the task's assembly-line runs", async () => {
    await getTaskRuns("t1");

    expect(url()).toEqual("http://api:3000/api/tasks/t1/runs");
  });
});

describe("getTaskLogs", () => {
  it("reads the log tail from the given offset", async () => {
    await getTaskLogs("t1", 2048);

    expect(url()).toEqual(
      "http://api:3000/api/task-logs?task_id=t1&offset=2048",
    );
  });

  it("reads from the start when no offset is given", async () => {
    await getTaskLogs("t1", 0);

    expect(url()).toEqual("http://api:3000/api/task-logs?task_id=t1&offset=0");
  });
});

describe("dashboard reads", () => {
  it("asks for a repo's recent tasks with a limit", async () => {
    await getRepoTasks("re-cinq/lore", 5);

    expect(url()).toContain("repo=re-cinq%2Flore");
    expect(url()).toContain("limit=5");
  });

  it("defaults the repo task list to 15", async () => {
    await getRepoTasks("re-cinq/lore");

    expect(url()).toContain("limit=15");
  });

  it("reads the org-wide task totals", async () => {
    await getTaskStats();

    expect(url()).toEqual("http://api:3000/api/task-stats");
  });

  it("reads agent activity org-wide when no repo is given", async () => {
    await getAgentActivity();

    expect(url()).toEqual("http://api:3000/api/agent-activity");
  });

  it("scopes agent activity to a repo when one is given", async () => {
    await getAgentActivity("re-cinq/lore");

    expect(url()).toEqual(
      "http://api:3000/api/agent-activity?repo=re-cinq%2Flore",
    );
  });

  it("reads one task's runtime trail", async () => {
    await getTaskRuntime("t1");

    expect(url()).toEqual("http://api:3000/api/tasks/t1/runtime");
  });

  it("names the audit event types the caller renders", async () => {
    await getAuditLog("re-cinq/lore", ["auto_merge_decision", "escalation"]);

    expect(url()).toContain("event_types=auto_merge_decision%2Cescalation");
    expect(url()).toContain("limit=25");
  });
});
