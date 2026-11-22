import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import {
  checkedToolHandlers,
  toolHandlers,
} from "../shared/tool-test-helpers.js";
import { registerGetPipelineStatusTool } from "./get-pipeline-status.js";

const fetchMock = vi.fn();
const getPipelineStatus = toolHandlers(registerGetPipelineStatusTool, "full")[
  "lore_get_pipeline_status"
];
const textOf = async (args: Record<string, unknown>) =>
  (await getPipelineStatus(args)).content[0].text;

describe("lore_get_pipeline_status", () => {
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

  it("asks lore-api for the task and nothing else, whatever the id holds", async () => {
    fetchMock.mockResolvedValue({ ok: true, json: async () => ({}) });

    await getPipelineStatus({ task_id: "../repos/acme/shop/plans?" });

    const asked = new URL(fetchMock.mock.calls[0][0] as string);

    expect({ path: asked.pathname, search: asked.search }).toEqual({
      path: "/api/task/..%2Frepos%2Facme%2Fshop%2Fplans%3F",
      search: "",
    });
  });

  it.each([".", "..", ""])(
    "refuses task id %j at the registered tool and asks lore-api nothing",
    async (task_id) => {
      const registered = checkedToolHandlers(
        registerGetPipelineStatusTool,
        "full",
      )["lore_get_pipeline_status"];

      await expect(registered({ task_id })).rejects.toThrow();
      expect(fetchMock).not.toHaveBeenCalled();
    },
  );

  it("returns the not-configured message without fetching when the env is unset", async () => {
    vi.stubEnv("LORE_API_URL", "");
    vi.stubEnv("LORE_INGEST_TOKEN", "");

    expect(await textOf({ task_id: "t1" })).toContain(
      "not configured for getting pipeline status",
    );
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("returns task t1's record as pretty JSON read from /api/task/t1 with the bearer token", async () => {
    fetchMock.mockResolvedValue({
      ok: true,
      json: async () => ({ id: "t1", status: "running" }),
    });

    expect(await textOf({ task_id: "t1" })).toBe(
      JSON.stringify({ id: "t1", status: "running" }, null, 2),
    );
    expect(fetchMock.mock.calls[0]).toMatchObject([
      "https://lore-api.example.com/api/task/t1",
      { headers: { Authorization: "Bearer tok" } },
    ]);
  });

  it("returns the denied message on a 401", async () => {
    fetchMock.mockResolvedValue({
      ok: false,
      status: 401,
      statusText: "Unauthorized",
    });

    expect(await textOf({ task_id: "t1" })).toContain(
      "denied access for getting pipeline status",
    );
  });

  it("returns 'Remote error: Not Found' on a 404", async () => {
    fetchMock.mockResolvedValue({
      ok: false,
      status: 404,
      statusText: "Not Found",
    });

    expect(await textOf({ task_id: "t1" })).toBe("Remote error: Not Found");
  });

  it("returns the unreachable message when fetch throws", async () => {
    fetchMock.mockRejectedValue(new Error("connect ECONNREFUSED"));

    expect(await textOf({ task_id: "t1" })).toContain(
      "unreachable for getting pipeline status",
    );
  });

  it("returns the error text when the response body is not JSON", async () => {
    fetchMock.mockResolvedValue({
      ok: true,
      json: async () => {
        throw new Error("bad json");
      },
    });

    expect(await textOf({ task_id: "t1" })).toBe(
      "Error getting pipeline status: bad json",
    );
  });
});
