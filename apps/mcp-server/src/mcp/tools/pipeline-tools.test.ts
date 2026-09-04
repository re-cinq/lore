import {
  describe,
  it,
  expect,
  beforeAll,
  beforeEach,
  afterEach,
  vi,
} from "vitest";
import { mkdtempSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { z, type ZodTypeAny } from "zod";

const fakeHome = mkdtempSync(join(tmpdir(), "lore-pipeline-home-"));

process.env.HOME = fakeHome;

type ToolHandler = (
  args: Record<string, unknown>,
) => Promise<{ content: { type: string; text: string }[] }>;
type ToolSchema = Record<string, ZodTypeAny>;

const handlers: Record<string, ToolHandler> = {};
const schemas: Record<string, ToolSchema> = {};
const fetchMock = vi.fn();

beforeAll(async () => {
  const fakeServer = {
    tool(
      name: string,
      _desc: string,
      schema: ToolSchema,
      _handler: ToolHandler,
    ) {
      schemas[name] = schema;
      handlers[name] = _handler;
    },
  };
  const { registerPipelineTools } = await import("./pipeline-tools.js");
  const { registerContextTools } = await import("./context-tools.js");

  registerPipelineTools(fakeServer as never);
  registerContextTools(fakeServer as never);
});

describe("lore_list_pending_tasks file-fallback repo filter", () => {
  beforeEach(() => {
    vi.stubEnv("LORE_API_URL", "");
    vi.stubEnv("LORE_INGEST_TOKEN", "");
    mkdirSync(join(fakeHome, ".lore"), { recursive: true });
    writeFileSync(
      join(fakeHome, ".lore", "pending-tasks.json"),
      JSON.stringify([
        {
          id: "aaaaaaaa1111",
          description: "wire the widget",
          task_type: "implementation",
          target_repo: "re-cinq/lore",
          created_at: "2026-07-16T00:00:00Z",
        },
        {
          id: "bbbbbbbb2222",
          description: "patch the gadget",
          task_type: "general",
          target_repo: "other/repo",
          created_at: "2026-07-16T00:00:00Z",
        },
      ]),
    );
  });
  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it("returns only the matching repo's tasks", async () => {
    const result = await handlers["lore_list_pending_tasks"]({
      repo: "re-cinq/lore",
    });
    const text = result.content[0].text;

    expect(text).toContain("re-cinq/lore");
    expect(text).not.toContain("other/repo");
  });

  it("returns the repo-scoped empty message when nothing matches", async () => {
    const result = await handlers["lore_list_pending_tasks"]({
      repo: "nobody/nothing",
    });

    expect(result.content[0].text).toBe("No pending tasks for nobody/nothing.");
  });

  it("returns all repos when no filter is given", async () => {
    const result = await handlers["lore_list_pending_tasks"]({});
    const text = result.content[0].text;

    expect(text).toContain("re-cinq/lore");
    expect(text).toContain("other/repo");
  });
});

describe("lore_list_pending_tasks API path", () => {
  beforeEach(() => {
    fetchMock.mockReset();
    vi.stubGlobal("fetch", fetchMock);
    vi.stubEnv("LORE_API_URL", "https://lore-api.example.com");
    vi.stubEnv("LORE_INGEST_TOKEN", "tok");
    mkdirSync(join(fakeHome, ".lore"), { recursive: true });
    writeFileSync(join(fakeHome, ".lore", "pending-tasks.json"), "[]");
  });
  afterEach(() => {
    vi.unstubAllEnvs();
    vi.unstubAllGlobals();
  });

  it("groups the API's tasks by repo, filtered by the repo param", async () => {
    fetchMock.mockResolvedValue({
      ok: true,
      json: async () => ({
        tasks: [
          {
            id: "aaaaaaaa1111",
            description: "wire the widget",
            task_type: "implementation",
            target_repo: "re-cinq/lore",
          },
          {
            id: "bbbbbbbb2222",
            description: "patch the gadget",
            task_type: "general",
            target_repo: "other/repo",
          },
        ],
      }),
    });

    const result = await handlers["lore_list_pending_tasks"]({
      repo: "re-cinq/lore",
    });

    expect(result.content[0].text).toContain("re-cinq/lore");
    expect(result.content[0].text).not.toContain("other/repo");
  });

  it("falls back to the local file listing when the API responds non-ok", async () => {
    fetchMock.mockResolvedValue({ ok: false, status: 500 });

    const result = await handlers["lore_list_pending_tasks"]({});

    expect(result.content[0].text).toBe("No pending tasks.");
  });
});

describe("zod schema bounds", () => {
  it("rejects a task description over 10000 chars", () => {
    const result = z
      .object(schemas["lore_create_pipeline_task"])
      .safeParse({ description: "a".repeat(10001) });

    expect(result.success).toBe(false);
  });

  it("rejects an empty task description", () => {
    const result = z
      .object(schemas["lore_create_pipeline_task"])
      .safeParse({ description: "" });

    expect(result.success).toBe(false);
  });

  it("rejects a whitespace-only task description", () => {
    const result = z
      .object(schemas["lore_create_pipeline_task"])
      .safeParse({ description: "   " });

    expect(result.success).toBe(false);
  });

  it("accepts an in-range task description", () => {
    const result = z
      .object(schemas["lore_create_pipeline_task"])
      .safeParse({ description: "wire the widget" });

    expect(result.success).toBe(true);
  });

  it("rejects max_tokens below the 2000 floor", () => {
    const result = z
      .object(schemas["lore_assemble_context"])
      .safeParse({ query: "auth flow", max_tokens: 1999 });

    expect(result.success).toBe(false);
  });

  it("accepts max_tokens at the 2000 floor", () => {
    const result = z
      .object(schemas["lore_assemble_context"])
      .safeParse({ query: "auth flow", max_tokens: 2000 });

    expect(result.success).toBe(true);
  });
});

describe("lore_get_pipeline_status proxy error-code selection", () => {
  beforeEach(() => {
    fetchMock.mockReset();
    vi.stubGlobal("fetch", fetchMock);
  });
  afterEach(() => {
    vi.unstubAllEnvs();
    vi.unstubAllGlobals();
  });

  it("returns the not-configured message when the env is unset", async () => {
    vi.stubEnv("LORE_API_URL", "");
    vi.stubEnv("LORE_INGEST_TOKEN", "");

    const result = await handlers["lore_get_pipeline_status"]({
      task_id: "t1",
    });

    expect(result.content[0].text).toContain(
      "not configured for getting pipeline status",
    );
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("returns the denied message on a 401", async () => {
    vi.stubEnv("LORE_API_URL", "https://lore-api.example.com");
    vi.stubEnv("LORE_INGEST_TOKEN", "tok");
    fetchMock.mockResolvedValue({
      ok: false,
      status: 401,
      statusText: "Unauthorized",
    });

    const result = await handlers["lore_get_pipeline_status"]({
      task_id: "t1",
    });

    expect(result.content[0].text).toContain(
      "denied access for getting pipeline status",
    );
  });

  it("returns the unreachable message when fetch throws", async () => {
    vi.stubEnv("LORE_API_URL", "https://lore-api.example.com");
    vi.stubEnv("LORE_INGEST_TOKEN", "tok");
    fetchMock.mockRejectedValue(new Error("connect ECONNREFUSED"));

    const result = await handlers["lore_get_pipeline_status"]({
      task_id: "t1",
    });

    expect(result.content[0].text).toContain(
      "unreachable for getting pipeline status",
    );
  });
});

describe("lore_create_pipeline_task onboard refusal", () => {
  it("refuses task_type onboard and names lore_onboard_repo instead", async () => {
    const result = await handlers["lore_create_pipeline_task"]({
      description: "onboard our new service",
      task_type: "onboard",
    });

    expect(result.content[0].text).toContain("lore_onboard_repo");
  });
});

describe("lore_create_pipeline_task API path", () => {
  beforeEach(() => {
    fetchMock.mockReset();
    vi.stubGlobal("fetch", fetchMock);
  });
  afterEach(() => {
    vi.unstubAllEnvs();
    vi.unstubAllGlobals();
  });

  it("returns the not-configured message when the env is unset", async () => {
    vi.stubEnv("LORE_API_URL", "");
    vi.stubEnv("LORE_INGEST_TOKEN", "");

    const result = await handlers["lore_create_pipeline_task"]({
      description: "wire the widget",
      task_type: "general",
      target_repo: "re-cinq/lore",
      priority: "normal",
    });

    expect(result.content[0].text).toContain("not configured");
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("reports the immediate pickup hint on success", async () => {
    vi.stubEnv("LORE_API_URL", "https://lore-api.example.com");
    vi.stubEnv("LORE_INGEST_TOKEN", "tok");
    fetchMock.mockResolvedValue({
      ok: true,
      json: async () => ({ task_id: "t1", task_type: "general" }),
    });

    const result = await handlers["lore_create_pipeline_task"]({
      description: "wire the widget",
      task_type: "general",
      target_repo: "re-cinq/lore",
      priority: "immediate",
    });

    expect(result.content[0].text).toContain(
      "The GKE agent will pick this up within 30 seconds.",
    );
  });

  it("reports a denied error on a 401", async () => {
    vi.stubEnv("LORE_API_URL", "https://lore-api.example.com");
    vi.stubEnv("LORE_INGEST_TOKEN", "tok");
    fetchMock.mockResolvedValue({
      ok: false,
      status: 401,
      statusText: "Unauthorized",
    });

    const result = await handlers["lore_create_pipeline_task"]({
      description: "wire the widget",
      task_type: "general",
      target_repo: "re-cinq/lore",
      priority: "normal",
    });

    expect(result.content[0].text).toContain("denied access");
  });
});

describe("pipeline tools that proxy to lore-api (ADR-032) with real proxy helpers and only fetch stubbed", () => {
  const jsonOk = (body: unknown) =>
    fetchMock.mockResolvedValue({ ok: true, json: async () => body });
  const callOf = (index = 0) => {
    const [url, opts] = fetchMock.mock.calls[index] as [
      string,
      { method?: string; body?: string },
    ];

    return {
      url,
      method: opts?.method,
      body: JSON.parse(opts?.body ?? "null"),
    };
  };

  beforeEach(() => {
    fetchMock.mockReset();
    vi.stubGlobal("fetch", fetchMock);
    vi.stubEnv("LORE_API_URL", "https://lore-api.example.com");
    vi.stubEnv("LORE_INGEST_TOKEN", "tok");
    vi.stubEnv("LORE_AGENT_ID", "agent-7");
  });
  afterEach(() => {
    vi.unstubAllEnvs();
    vi.unstubAllGlobals();
  });

  it("lore_cancel_task posts the cancel action and returns the API result", async () => {
    jsonOk({ task_id: "t1", status: "cancelled" });

    const result = await handlers["lore_cancel_task"]({ task_id: "t1" });

    expect(callOf()).toMatchObject({
      url: "https://lore-api.example.com/api/task",
      method: "POST",
      body: { action: "cancel", task_id: "t1" },
    });
    expect(result.content[0].text).toBe(
      JSON.stringify({ task_id: "t1", status: "cancelled" }),
    );
  });

  it("lore_cancel_task reports the server's refusal for a merged task", async () => {
    fetchMock.mockResolvedValue({
      ok: false,
      status: 409,
      statusText: "Conflict",
      text: async () =>
        JSON.stringify({ error: "Cannot cancel task in merged state" }),
    });

    const result = await handlers["lore_cancel_task"]({ task_id: "t1" });

    expect(result.content[0].text).toBe(
      "The Lore API refused cancelling a task: HTTP 409 Conflict: Cannot cancel task in merged state",
    );
  });

  it("lore_cancel_task reports a denied error on a 401 without retrying", async () => {
    fetchMock.mockResolvedValue({
      ok: false,
      status: 401,
      statusText: "Unauthorized",
    });

    const result = await handlers["lore_cancel_task"]({ task_id: "t1" });

    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(result.content[0].text).toContain("denied access");
  });

  it(
    "lore_list_task_group reports a subject-scoped fetch message when the API is unreachable",
    async () => {
      fetchMock.mockRejectedValue(new Error("connect ECONNREFUSED"));

      const result = await handlers["lore_list_task_group"]({
        group_id: "g1",
      });

      expect(result.content[0].text).toContain(
        "Could not fetch the task group from the Lore API",
      );
    },
    10_000,
  );

  it("lore_retry_task posts the retry action and returns the new task", async () => {
    jsonOk({ task_id: "t2", retry_of: "t1" });

    const result = await handlers["lore_retry_task"]({ task_id: "t1" });

    expect(callOf()).toMatchObject({
      url: "https://lore-api.example.com/api/task",
      body: { action: "retry", task_id: "t1" },
    });
    expect(result.content[0].text).toBe(
      JSON.stringify({ task_id: "t2", retry_of: "t1" }),
    );
  });

  it("lore_list_task_group renders the rollup line above the task JSON", async () => {
    const tasks = [
      { id: "t1", status: "merged" },
      { id: "t2", status: "running" },
    ];

    jsonOk({ group_id: "g1", total: 2, completed: 1, tasks });

    const result = await handlers["lore_list_task_group"]({ group_id: "g1" });

    expect(callOf().url).toBe(
      "https://lore-api.example.com/api/task-groups/g1",
    );
    expect(result.content[0].text).toBe(
      `Group g1: 1/2 completed\n\n${JSON.stringify(tasks, null, 2)}`,
    );
  });

  it("lore_list_task_group reports an empty group", async () => {
    jsonOk({ group_id: "g1", total: 0, completed: 0, tasks: [] });

    const result = await handlers["lore_list_task_group"]({ group_id: "g1" });

    expect(result.content[0].text).toBe("No tasks found for group g1");
  });

  it("lore_sync_tasks posts the raw markdown and summarizes the counts", async () => {
    jsonOk({ parsed: 3, synced: 3, created: 2 });

    const result = await handlers["lore_sync_tasks"]({
      tasks_markdown: "- [ ] T001 Wire it",
      repo: "o/r",
      spec_slug: "widgets",
    });

    expect(callOf()).toMatchObject({
      url: "https://lore-api.example.com/api/spec-tasks/sync",
      body: {
        repo: "o/r",
        spec_slug: "widgets",
        tasks_markdown: "- [ ] T001 Wire it",
      },
    });
    expect(result.content[0].text).toBe(
      "Synced 3 tasks (2 new) for o/r / widgets.",
    );
  });

  it("lore_sync_tasks reports markdown with no tasks", async () => {
    jsonOk({ parsed: 0, synced: 0, created: 0 });

    const result = await handlers["lore_sync_tasks"]({
      tasks_markdown: "# nothing",
      repo: "o/r",
      spec_slug: "widgets",
    });

    expect(result.content[0].text).toBe(
      "No tasks found in the provided markdown.",
    );
  });

  it("lore_ready_tasks renders one bullet per ready task", async () => {
    jsonOk({
      tasks: [
        {
          id: "t1",
          description: "wire the widget",
          context_bundle: { spec_task_id: "T001" },
        },
      ],
    });

    const result = await handlers["lore_ready_tasks"]({ repo: "o/r" });

    expect(callOf().url).toBe(
      "https://lore-api.example.com/api/spec-tasks/ready?repo=o%2Fr",
    );
    expect(result.content[0].text).toBe(
      "## Ready tasks\n\n- **T001** (t1): wire the widget",
    );
  });

  it("lore_ready_tasks reports an empty ready set", async () => {
    jsonOk({ tasks: [] });

    const result = await handlers["lore_ready_tasks"]({ repo: "o/r" });

    expect(result.content[0].text).toBe(
      "No ready tasks. All tasks are either completed, claimed, or blocked by dependencies.",
    );
  });

  it("lore_claim_task posts the resolved agent id and confirms the claim", async () => {
    jsonOk({ claimed: true, task_id: "t1", agent_id: "agent-7" });

    const result = await handlers["lore_claim_task"]({ task_id: "t1" });

    expect(callOf()).toMatchObject({
      url: "https://lore-api.example.com/api/spec-tasks/claim",
      body: { task_id: "t1", agent_id: "agent-7" },
    });
    expect(result.content[0].text).toBe("Task t1 claimed by agent-7.");
  });

  it("lore_claim_task reports a task that could not be claimed", async () => {
    jsonOk({ claimed: false, task_id: "t1", agent_id: "agent-7" });

    const result = await handlers["lore_claim_task"]({ task_id: "t1" });

    expect(result.content[0].text).toBe(
      "Could not claim task t1. It may already be claimed or does not exist.",
    );
  });

  it("lore_complete_task lists the newly unblocked dependents", async () => {
    jsonOk({ completed: true, unblocked: ["T002", "T003"] });

    const result = await handlers["lore_complete_task"]({ task_id: "t1" });

    expect(callOf()).toMatchObject({
      url: "https://lore-api.example.com/api/spec-tasks/complete",
      body: { task_id: "t1" },
    });
    expect(result.content[0].text).toBe(
      "Task t1 completed.\n\nNewly unblocked tasks:\n- T002\n- T003",
    );
  });

  it("lore_complete_task reports a task that was not running", async () => {
    jsonOk({ completed: false, unblocked: [] });

    const result = await handlers["lore_complete_task"]({ task_id: "t1" });

    expect(result.content[0].text).toBe(
      "Could not complete task t1. It may not be in 'running' state.",
    );
  });

  it("every proxied pipeline tool reports a missing API configuration", async () => {
    vi.stubEnv("LORE_API_URL", "");
    vi.stubEnv("LORE_INGEST_TOKEN", "");

    const results = await Promise.all([
      handlers["lore_cancel_task"]({ task_id: "t1" }),
      handlers["lore_retry_task"]({ task_id: "t1" }),
      handlers["lore_list_task_group"]({ group_id: "g1" }),
      handlers["lore_ready_tasks"]({ repo: "o/r" }),
      handlers["lore_claim_task"]({ task_id: "t1" }),
      handlers["lore_complete_task"]({ task_id: "t1" }),
      handlers["lore_sync_tasks"]({
        tasks_markdown: "- [ ] T001 x",
        repo: "o/r",
        spec_slug: "s",
      }),
    ]);

    expect(results.map((r) => r.content[0].text)).toSatisfy((texts: string[]) =>
      texts.every((t) => t.includes("Lore API not configured")),
    );
    expect(fetchMock).not.toHaveBeenCalled();
  });
});

describe("lore_get_task_logs and lore_get_job_logs proxy", () => {
  beforeEach(() => {
    fetchMock.mockReset();
    vi.stubGlobal("fetch", fetchMock);
  });
  afterEach(() => {
    vi.unstubAllEnvs();
    vi.unstubAllGlobals();
  });

  it("lore_get_task_logs reports the require-URL message when the env is unset", async () => {
    vi.stubEnv("LORE_API_URL", "");
    vi.stubEnv("LORE_INGEST_TOKEN", "");

    const result = await handlers["lore_get_task_logs"]({
      task_id: "t1",
      offset: 0,
    });

    expect(result.content[0].text).toBe("Task logs require LORE_API_URL.");
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("lore_get_task_logs returns the proxied body on success", async () => {
    vi.stubEnv("LORE_API_URL", "https://lore-api.example.com");
    vi.stubEnv("LORE_INGEST_TOKEN", "tok");
    fetchMock.mockResolvedValue({
      ok: true,
      json: async () => ({ logs: "hello", next_offset: 5, complete: true }),
    });

    const result = await handlers["lore_get_task_logs"]({
      task_id: "t1",
      offset: 0,
    });

    expect(JSON.parse(result.content[0].text)).toEqual({
      logs: "hello",
      next_offset: 5,
      complete: true,
    });
  });

  it("lore_get_task_logs reports a denied error on a 401", async () => {
    vi.stubEnv("LORE_API_URL", "https://lore-api.example.com");
    vi.stubEnv("LORE_INGEST_TOKEN", "tok");
    fetchMock.mockResolvedValue({ ok: false, status: 401, statusText: "Unauthorized" });

    const result = await handlers["lore_get_task_logs"]({
      task_id: "t1",
      offset: 0,
    });

    expect(result.content[0].text).toContain("denied access");
  });

  it("lore_get_task_logs reports an unreachable error on a non-auth failure", async () => {
    vi.stubEnv("LORE_API_URL", "https://lore-api.example.com");
    vi.stubEnv("LORE_INGEST_TOKEN", "tok");
    fetchMock.mockResolvedValue({ ok: false, status: 500, statusText: "Server Error" });

    const result = await handlers["lore_get_task_logs"]({
      task_id: "t1",
      offset: 0,
    });

    expect(result.content[0].text).toContain("unreachable");
  });

  it("lore_get_job_logs reports the require-URL message when the env is unset", async () => {
    vi.stubEnv("LORE_API_URL", "");
    vi.stubEnv("LORE_INGEST_TOKEN", "");

    const result = await handlers["lore_get_job_logs"]({
      job_name: "context_reindex",
      run_id: "r1",
    });

    expect(result.content[0].text).toBe("Job-run logs require LORE_API_URL.");
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("lore_get_job_logs returns the proxied body on success", async () => {
    vi.stubEnv("LORE_API_URL", "https://lore-api.example.com");
    vi.stubEnv("LORE_INGEST_TOKEN", "tok");
    fetchMock.mockResolvedValue({
      ok: true,
      json: async () => ({ logs: "job output", complete: true }),
    });

    const result = await handlers["lore_get_job_logs"]({
      job_name: "context_reindex",
      run_id: "r1",
    });

    expect(JSON.parse(result.content[0].text)).toEqual({
      logs: "job output",
      complete: true,
    });
  });
});

describe("lore_get_task_logs description spec parity", () => {
  it("matches the spec's verbatim description block", async () => {
    const captured: Record<string, string> = {};
    const { registerPipelineTools } = await import("./pipeline-tools.js");

    registerPipelineTools({
      tool(name: string, desc: string) {
        captured[name] = desc;
      },
    } as never);
    const spec = readFileSync(
      new URL(
        "../../../../../specs/mcp-tools/get-task-logs/spec.md",
        import.meta.url,
      ),
      "utf-8",
    );
    const verbatimBlock =
      /\*\*description\*\* \(verbatim\):\n\n```text\n([\s\S]*?)\n```/.exec(
        spec,
      )?.[1] ?? "";

    expect(captured["lore_get_task_logs"]).toBe(verbatimBlock);
  });
});
