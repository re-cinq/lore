import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { toolHandlers } from "../shared/tool-test-helpers.js";
import { registerListPipelineTasksTool } from "./list-pipeline-tasks.js";

const fetchMock = vi.fn();
const listPipelineTasks = toolHandlers(registerListPipelineTasksTool, "full")[
  "lore_list_pipeline_tasks"
];
const textOf = async (args: Record<string, unknown>) =>
  (await listPipelineTasks(args)).content[0].text;

describe("lore_list_pipeline_tasks", () => {
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

  it("asks for remote access without fetching when the env is unset", async () => {
    vi.stubEnv("LORE_API_URL", "");

    expect(await textOf({ limit: 20, offset: 0 })).toBe(
      "Pipeline requires LORE_API_URL + LORE_INGEST_TOKEN for remote access.",
    );
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("caps limit 500 at 100 and passes status failed and offset 40 to /api/tasks", async () => {
    fetchMock.mockResolvedValue({
      ok: true,
      json: async () => ({ tasks: [] }),
    });

    expect(await textOf({ status: "failed", limit: 500, offset: 40 })).toBe(
      JSON.stringify({ tasks: [] }, null, 2),
    );
    expect(fetchMock.mock.calls[0][0]).toBe(
      "https://lore-api.example.com/api/tasks?limit=100&offset=40&status=failed",
    );
  });

  it("leaves status out of the query when none is given", async () => {
    fetchMock.mockResolvedValue({ ok: true, json: async () => ({}) });
    await textOf({ limit: 20, offset: 0 });

    expect(fetchMock.mock.calls[0][0]).toBe(
      "https://lore-api.example.com/api/tasks?limit=20&offset=0",
    );
  });

  it("returns 'Remote error: Bad Gateway' on a 502", async () => {
    fetchMock.mockResolvedValue({ ok: false, statusText: "Bad Gateway" });

    expect(await textOf({ limit: 20, offset: 0 })).toBe(
      "Remote error: Bad Gateway",
    );
  });

  it("returns the error text when fetch throws", async () => {
    fetchMock.mockRejectedValue(new Error("connect ECONNREFUSED"));

    expect(await textOf({ limit: 20, offset: 0 })).toBe(
      "Error listing pipeline tasks: connect ECONNREFUSED",
    );
  });
});
