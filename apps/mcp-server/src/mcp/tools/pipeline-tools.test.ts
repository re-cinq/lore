import {
  describe,
  it,
  expect,
  beforeAll,
  beforeEach,
  afterEach,
  vi,
} from "vitest";
import { mkdtempSync, mkdirSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { z, type ZodTypeAny } from "zod";

// runner.local.js captures LORE_DIR from os.homedir() at module load, so HOME
// must point at a temp dir before its first (lazy) import inside the handlers.
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

  registerPipelineTools(fakeServer as never, { getPool: () => null });
  registerContextTools(fakeServer as never, { getPool: () => null });
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
