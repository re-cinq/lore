import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { toolHandlers } from "../shared/tool-test-helpers.js";
import { registerRetryTaskTool } from "./retry-task.js";

const fetchMock = vi.fn();
const retryTask = toolHandlers(registerRetryTaskTool, "full")[
  "lore_retry_task"
];
const textOf = async (args: Record<string, unknown>) =>
  (await retryTask(args)).content[0].text;

describe("lore_retry_task", () => {
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

  it("posts the retry action for t1 and returns the new task t2", async () => {
    fetchMock.mockResolvedValue({
      ok: true,
      json: async () => ({ task_id: "t2", retry_of: "t1" }),
    });

    expect(await textOf({ task_id: "t1" })).toBe(
      JSON.stringify({ task_id: "t2", retry_of: "t1" }),
    );
    expect(fetchMock.mock.calls[0]).toMatchObject([
      "https://lore-api.example.com/api/task",
      { body: JSON.stringify({ action: "retry", task_id: "t1" }) },
    ]);
  });

  it("reports a missing API configuration without fetching", async () => {
    vi.stubEnv("LORE_API_URL", "");

    expect(await textOf({ task_id: "t1" })).toContain(
      "Lore API not configured",
    );
    expect(fetchMock).not.toHaveBeenCalled();
  });
});
