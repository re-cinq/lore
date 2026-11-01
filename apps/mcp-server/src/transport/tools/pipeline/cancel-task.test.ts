import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { toolHandlers } from "../shared/tool-test-helpers.js";
import { registerCancelTaskTool } from "./cancel-task.js";

const fetchMock = vi.fn();
const cancelTask = toolHandlers(registerCancelTaskTool, "full")[
  "lore_cancel_task"
];
const textOf = async (args: Record<string, unknown>) =>
  (await cancelTask(args)).content[0].text;

describe("lore_cancel_task", () => {
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

  it("posts the cancel action for t1 and returns the API result", async () => {
    fetchMock.mockResolvedValue({
      ok: true,
      json: async () => ({ task_id: "t1", status: "cancelled" }),
    });

    expect(await textOf({ task_id: "t1" })).toBe(
      JSON.stringify({ task_id: "t1", status: "cancelled" }),
    );
    expect(fetchMock.mock.calls[0]).toMatchObject([
      "https://lore-api.example.com/api/task",
      {
        method: "POST",
        body: JSON.stringify({ action: "cancel", task_id: "t1" }),
      },
    ]);
  });

  it("reports the server's refusal for a merged task", async () => {
    fetchMock.mockResolvedValue({
      ok: false,
      status: 409,
      statusText: "Conflict",
      text: async () =>
        JSON.stringify({ error: "Cannot cancel task in merged state" }),
    });

    expect(await textOf({ task_id: "t1" })).toBe(
      "The Lore API refused cancelling a task: HTTP 409 Conflict: Cannot cancel task in merged state",
    );
  });

  it("reports a denied error on a 401 after one request", async () => {
    fetchMock.mockResolvedValue({
      ok: false,
      status: 401,
      statusText: "Unauthorized",
    });

    expect(await textOf({ task_id: "t1" })).toContain("denied access");
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it("reports the API unreachable for cancelling a task when fetch keeps throwing", async () => {
    fetchMock.mockRejectedValue(new Error("connect ECONNREFUSED"));

    expect(await textOf({ task_id: "t1" })).toContain(
      "unreachable for cancelling a task",
    );
  }, 10_000);

  it("reports a missing API configuration without fetching", async () => {
    vi.stubEnv("LORE_API_URL", "");

    expect(await textOf({ task_id: "t1" })).toContain(
      "Lore API not configured",
    );
    expect(fetchMock).not.toHaveBeenCalled();
  });
});
