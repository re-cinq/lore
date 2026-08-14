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
