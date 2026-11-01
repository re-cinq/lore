import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { toolHandlers } from "../shared/tool-test-helpers.js";
import { registerListTaskGroupTool } from "./list-task-group.js";

const fetchMock = vi.fn();
const listTaskGroup = toolHandlers(registerListTaskGroupTool, "full")[
  "lore_list_task_group"
];
const textOf = async (args: Record<string, unknown>) =>
  (await listTaskGroup(args)).content[0].text;
const jsonOk = (body: unknown) =>
  fetchMock.mockResolvedValue({ ok: true, json: async () => body });

describe("lore_list_task_group", () => {
  beforeEach(() => {
    fetchMock.mockReset();
    vi.stubGlobal("fetch", fetchMock);
    vi.stubEnv("LORE_API_URL", "https://lore-api.example.com");
    vi.stubEnv("LORE_INGEST_TOKEN", "tok");
  });
  afterEach(() => {
    vi.unstubAllEnvs();
    vi.unstubAllGlobals();
  });

  it("renders 'Group g1: 1/2 completed' above the task JSON read from /api/task-groups/g1", async () => {
    const tasks = [
      { id: "t1", status: "merged" },
      { id: "t2", status: "running" },
    ];

    jsonOk({ group_id: "g1", total: 2, completed: 1, tasks });

    expect(await textOf({ group_id: "g1" })).toBe(
      `Group g1: 1/2 completed\n\n${JSON.stringify(tasks, null, 2)}`,
    );
    expect(fetchMock.mock.calls[0][0]).toBe(
      "https://lore-api.example.com/api/task-groups/g1",
    );
  });

  it("reports an empty group g1", async () => {
    jsonOk({ group_id: "g1", total: 0, completed: 0, tasks: [] });

    expect(await textOf({ group_id: "g1" })).toBe(
      "No tasks found for group g1",
    );
  });

  it("reports the error when the API answers a null body", async () => {
    jsonOk(null);

    expect(await textOf({ group_id: "g1" })).toMatch(
      /^Error listing a task group: /,
    );
  });

  it("reports a subject-scoped fetch message when the API is unreachable", async () => {
    fetchMock.mockRejectedValue(new Error("connect ECONNREFUSED"));

    expect(await textOf({ group_id: "g1" })).toContain(
      "Could not fetch the task group from the Lore API",
    );
  }, 10_000);

  it("reports a missing API configuration without fetching", async () => {
    vi.stubEnv("LORE_API_URL", "");

    expect(await textOf({ group_id: "g1" })).toContain(
      "Lore API not configured",
    );
    expect(fetchMock).not.toHaveBeenCalled();
  });
});
