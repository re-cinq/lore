import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { toolHandlers } from "../shared/tool-test-helpers.js";
import { registerGetJobLogsTool } from "./get-job-logs.js";

const fetchMock = vi.fn();
const getJobLogs = toolHandlers(registerGetJobLogsTool, "full")[
  "lore_get_job_logs"
];
const textOf = async (args: Record<string, unknown>) =>
  (await getJobLogs(args)).content[0].text;

describe("lore_get_job_logs", () => {
  beforeEach(() => {
    fetchMock.mockReset();
    vi.stubGlobal("fetch", fetchMock);
    vi.stubEnv("LORE_API_URL", "https://lore-api.example.com");
    vi.stubEnv("LORE_INGEST_TOKEN", "tok");
    vi.stubEnv("LORE_CACHE_ENABLED", "false");
  });
  afterEach(() => {
    vi.unstubAllEnvs();
    vi.unstubAllGlobals();
  });

  it("reports the require-URL message without fetching when the env is unset", async () => {
    vi.stubEnv("LORE_API_URL", "");

    expect(await textOf({ job_name: "context_reindex", run_id: "r1" })).toBe(
      "Job-run logs require LORE_API_URL.",
    );
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("returns the job output read from /api/job-run-logs for context_reindex run r1", async () => {
    fetchMock.mockResolvedValue({
      ok: true,
      json: async () => ({ logs: "job output", complete: true }),
    });

    expect(
      JSON.parse(await textOf({ job_name: "context_reindex", run_id: "r1" })),
    ).toEqual({ logs: "job output", complete: true });
    expect(fetchMock.mock.calls[0][0]).toBe(
      "https://lore-api.example.com/api/job-run-logs?job_name=context_reindex&run_id=r1",
    );
  });

  it("returns the error text when fetch throws", async () => {
    fetchMock.mockRejectedValue(new Error("connect ECONNREFUSED"));

    expect(await textOf({ job_name: "context_reindex", run_id: "r1" })).toBe(
      "Error getting job logs: connect ECONNREFUSED",
    );
  });
});
