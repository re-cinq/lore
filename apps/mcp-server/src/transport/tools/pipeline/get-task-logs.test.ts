import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { mkdtempSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

process.env.HOME = mkdtempSync(join(tmpdir(), "lore-task-logs-home-"));

const { toolHandlers } = await import("../shared/tool-test-helpers.js");
const { registerGetTaskLogsTool } = await import("./get-task-logs.js");
const { registerPipelineTools } = await import("./index.js");

const fetchMock = vi.fn();
const getTaskLogs = toolHandlers(registerGetTaskLogsTool, "full")[
  "lore_get_task_logs"
];
const textOf = async (args: Record<string, unknown>) =>
  (await getTaskLogs(args)).content[0].text;

describe("lore_get_task_logs", () => {
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

    expect(await textOf({ task_id: "t1", offset: 0 })).toBe(
      "Task logs require LORE_API_URL.",
    );
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("returns the proxied body read from /api/task-logs at offset 0", async () => {
    fetchMock.mockResolvedValue({
      ok: true,
      json: async () => ({ logs: "hello", next_offset: 5, complete: true }),
    });

    expect(JSON.parse(await textOf({ task_id: "t1", offset: 0 }))).toEqual({
      logs: "hello",
      next_offset: 5,
      complete: true,
    });
    expect(fetchMock.mock.calls[0][0]).toBe(
      "https://lore-api.example.com/api/task-logs?task_id=t1&offset=0",
    );
  });

  it("passes cursor c9 back with offset 5", async () => {
    fetchMock.mockResolvedValue({ ok: true, json: async () => ({}) });
    await textOf({ task_id: "t1", offset: 5, cursor: "c9" });

    expect(fetchMock.mock.calls[0][0]).toBe(
      "https://lore-api.example.com/api/task-logs?task_id=t1&offset=5&cursor=c9",
    );
  });

  it("reports a denied error on a 401", async () => {
    fetchMock.mockResolvedValue({
      ok: false,
      status: 401,
      statusText: "Unauthorized",
    });

    expect(await textOf({ task_id: "t1", offset: 0 })).toContain(
      "denied access",
    );
  });

  it("reports HTTP 500 as unreachable", async () => {
    fetchMock.mockResolvedValue({
      ok: false,
      status: 500,
      statusText: "Server Error",
    });

    expect(await textOf({ task_id: "t1", offset: 0 })).toContain(
      "Lore API unreachable for lore_get_task_logs after 4 attempts: HTTP 500 Server Error.",
    );
  });

  it("returns the error text when fetch throws", async () => {
    fetchMock.mockRejectedValue(new Error("connect ECONNREFUSED"));

    expect(await textOf({ task_id: "t1", offset: 0 })).toBe(
      "Error getting task logs: connect ECONNREFUSED",
    );
  });

  it("serves a complete transcript from the cache on the second read", async () => {
    vi.stubEnv("LORE_CACHE_ENABLED", "true");
    fetchMock.mockResolvedValue({
      ok: true,
      json: async () => ({ logs: "done", complete: true }),
    });
    await textOf({ task_id: "cached-complete", offset: 0 });
    await textOf({ task_id: "cached-complete", offset: 0 });

    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it("fetches an incomplete transcript again on the second read", async () => {
    vi.stubEnv("LORE_CACHE_ENABLED", "true");
    fetchMock.mockResolvedValue({
      ok: true,
      json: async () => ({ logs: "so far", complete: false }),
    });
    await textOf({ task_id: "cached-partial", offset: 0 });
    await textOf({ task_id: "cached-partial", offset: 0 });

    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it("fetches a transcript with no JSON body again on the second read", async () => {
    vi.stubEnv("LORE_CACHE_ENABLED", "true");
    fetchMock.mockResolvedValue({ ok: true, json: async () => undefined });
    await textOf({ task_id: "cached-empty", offset: 0 });
    await textOf({ task_id: "cached-empty", offset: 0 });

    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it("carries the verbatim description block of specs/mcp-tools/get-task-logs/spec.md", () => {
    const captured: Record<string, string> = {};

    registerPipelineTools({
      tool(name: string, desc: string) {
        captured[name] = desc;
      },
    } as never);
    const spec = readFileSync(
      new URL(
        "../../../../../../specs/mcp-tools/get-task-logs/spec.md",
        import.meta.url,
      ),
      "utf-8",
    );
    const verbatimBlock =
      /\*\*description\*\* \(verbatim\):\n\n```text\n([\s\S]*?)\n```/.exec(
        spec,
      )?.[1];

    expect(captured["lore_get_task_logs"]).toBe(verbatimBlock);
  });
});
