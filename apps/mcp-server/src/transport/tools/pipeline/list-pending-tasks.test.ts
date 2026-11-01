import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { mkdtempSync, mkdirSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { toolHandlers } from "../shared/tool-test-helpers.js";
import { registerListPendingTasksTool } from "./list-pending-tasks.js";

const fakeHome = mkdtempSync(join(tmpdir(), "lore-pending-home-"));

process.env.HOME = fakeHome;

const fetchMock = vi.fn();
const listPendingTasks = toolHandlers(registerListPendingTasksTool, "full")[
  "lore_list_pending_tasks"
];
const textOf = async (args: Record<string, unknown>) =>
  (await listPendingTasks(args)).content[0].text;
const writePendingCache = (tasks: unknown[]) => {
  mkdirSync(join(fakeHome, ".lore"), { recursive: true });
  writeFileSync(
    join(fakeHome, ".lore", "pending-tasks.json"),
    JSON.stringify(tasks),
  );
};

describe("lore_list_pending_tasks from the local cache", () => {
  beforeEach(() => {
    vi.stubEnv("LORE_API_URL", "");
    vi.stubEnv("LORE_INGEST_TOKEN", "");
    writePendingCache([
      {
        id: "aaaaaaaa1111",
        description: "wire the widget",
        task_type: "runbook",
        target_repo: "re-cinq/lore",
        issue_number: 42,
        created_at: "2026-07-16T00:00:00Z",
      },
      {
        id: "bbbbbbbb2222",
        description: "patch the gadget",
        task_type: "gap-fill",
        target_repo: "other/repo",
        created_at: "2026-07-16T00:00:00Z",
      },
    ]);
  });
  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it("lists only re-cinq/lore's task with its issue number when filtered to re-cinq/lore", async () => {
    expect(await textOf({ repo: "re-cinq/lore" })).toBe(
      "aaaaaaaa runbook re-cinq/lore #42\n  wire the widget",
    );
  });

  it("returns the repo-scoped empty message when nothing matches nobody/nothing", async () => {
    expect(await textOf({ repo: "nobody/nothing" })).toBe(
      "No pending tasks for nobody/nothing.",
    );
  });

  it("lists both repos' tasks when no filter is given", async () => {
    expect(await textOf({})).toBe(
      "aaaaaaaa runbook re-cinq/lore #42\n  wire the widget\n\nbbbbbbbb gap-fill other/repo\n  patch the gadget",
    );
  });

  it("returns 'No pending tasks.' for an empty cache", async () => {
    writePendingCache([]);

    expect(await textOf({})).toBe("No pending tasks.");
  });
});

describe("lore_list_pending_tasks from the API", () => {
  beforeEach(() => {
    fetchMock.mockReset();
    vi.stubGlobal("fetch", fetchMock);
    vi.stubEnv("LORE_API_URL", "https://lore-api.example.com");
    vi.stubEnv("LORE_INGEST_TOKEN", "tok");
    writePendingCache([]);
  });
  afterEach(() => {
    vi.unstubAllEnvs();
    vi.unstubAllGlobals();
  });

  const apiTasks = (tasks?: unknown[]) =>
    fetchMock.mockResolvedValue({
      ok: true,
      json: async () => (tasks ? { tasks } : {}),
    });

  it("groups the API's tasks by repo, an unnamed repo under unknown", async () => {
    apiTasks([
      {
        id: "aaaaaaaa1111",
        description: "wire the widget",
        task_type: "runbook",
        target_repo: "re-cinq/lore",
        issue_number: 7,
      },
      {
        id: "bbbbbbbb2222",
        task_type: "gap-fill",
        target_repo: "re-cinq/lore",
      },
      { id: "cccccccc3333", task_type: "runbook" },
    ]);

    expect(await textOf({})).toBe(
      "**re-cinq/lore** (2)\n  aaaaaaaa runbook #7 wire the widget\n  bbbbbbbb gap-fill \n\n**unknown** (1)\n  cccccccc runbook ",
    );
    expect(fetchMock.mock.calls[0][0]).toBe(
      "https://lore-api.example.com/api/tasks?status=pending&limit=50",
    );
  });

  it("keeps only re-cinq/lore's tasks when filtered to re-cinq/lore", async () => {
    apiTasks([
      { id: "aaaaaaaa1111", task_type: "runbook", target_repo: "re-cinq/lore" },
      { id: "bbbbbbbb2222", task_type: "runbook", target_repo: "other/repo" },
    ]);

    expect(await textOf({ repo: "re-cinq/lore" })).toBe(
      "**re-cinq/lore** (1)\n  aaaaaaaa runbook ",
    );
  });

  it("returns the repo-scoped empty message when no API task matches nobody/nothing", async () => {
    apiTasks([]);

    expect(await textOf({ repo: "nobody/nothing" })).toBe(
      "No pending tasks for nobody/nothing.",
    );
  });

  it("returns 'No pending tasks.' when the API body carries no task list", async () => {
    apiTasks();

    expect(await textOf({})).toBe("No pending tasks.");
  });

  it("falls back to the local cache when the API answers 500", async () => {
    fetchMock.mockResolvedValue({ ok: false, status: 500 });

    expect(await textOf({})).toBe("No pending tasks.");
  });

  it("returns the error text when fetch throws", async () => {
    fetchMock.mockRejectedValue(new Error("connect ECONNREFUSED"));

    expect(await textOf({})).toBe(
      "Error listing pending tasks: connect ECONNREFUSED",
    );
  });
});
