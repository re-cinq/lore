// Acceptance tests for the ticket:
// "lore-mcp gateway: a context call without `repo` is a 400, so an agent pod's first call fails"
//
// The gateway has no cwd so detectCurrentRepo() returns null. In agent mode
// (LORE_MCP_SERVER_MODE=agent) with the target repo available in LORE_MCP_REPO,
// both lore_assemble_context and lore_search_memory should use it as the
// default instead of sending repo= (empty) which the API rejects with 400.
//
// spec: specs/mcp-agent-mode-repo-default/spec.md (pending)

import {
  describe,
  it,
  expect,
  beforeAll,
  beforeEach,
  afterEach,
  vi,
} from "vitest";

type ToolHandler = (args: Record<string, unknown>) => Promise<{
  content: { type: string; text: string }[];
}>;

let assembleContext: ToolHandler;
let searchMemory: ToolHandler;

const originalEnv = { ...process.env };
const fetchMock = vi.fn();

beforeAll(async () => {
  const { registerContextTools } = await import("./context-tools.js");
  const { registerMemoryTools } = await import("./memory-tools.js");

  const handlers: Record<string, ToolHandler> = {};
  const fakeServer = {
    tool(name: string, _desc: string, _schema: unknown, handler: ToolHandler) {
      handlers[name] = handler;
    },
  };

  registerContextTools(fakeServer as never);
  registerMemoryTools(fakeServer as never);

  assembleContext = handlers["lore_assemble_context"];
  searchMemory = handlers["lore_search_memory"];
});

beforeEach(() => {
  fetchMock.mockReset();
  vi.stubGlobal("fetch", fetchMock);
});

afterEach(() => {
  vi.unstubAllGlobals();
  process.env = { ...originalEnv };
});

describe("lore_assemble_context in agent mode with LORE_MCP_REPO", () => {
  it("uses LORE_MCP_REPO env as default repo when repo arg is omitted", async () => {
    process.env.LORE_MCP_SERVER_MODE = "agent";
    process.env.LORE_MCP_REPO = "owner/testrepo";
    process.env.LORE_API_URL = "https://lore.example";
    process.env.LORE_INGEST_TOKEN = "tok";

    fetchMock.mockResolvedValue({
      ok: true,
      json: async () => ({ text: "ctx" }),
    });

    await assembleContext({ query: "deploy conventions", template: "default" });

    const [calledUrl] = fetchMock.mock.calls[0] as [string, unknown];
    const url = new URL(calledUrl);

    // Without the fix: url.searchParams.get("repo") === "" (empty string)
    // With the fix: url.searchParams.get("repo") === "owner/testrepo"
    expect(url.searchParams.get("repo")).toBe("owner/testrepo");
  });
});

describe("lore_search_memory in agent mode with LORE_MCP_REPO", () => {
  it("includes the env-defaulted repo in the memory API call body when repo arg is omitted", async () => {
    process.env.LORE_MCP_SERVER_MODE = "agent";
    process.env.LORE_MCP_REPO = "owner/testrepo";
    process.env.LORE_API_URL = "https://lore.example";
    process.env.LORE_INGEST_TOKEN = "tok";

    fetchMock.mockResolvedValue({
      ok: true,
      json: async () => ({ results: [] }),
    });

    await searchMemory({ query: "conventions", limit: 10 });

    const [, opts] = fetchMock.mock.calls[0] as [string, RequestInit];
    const body = JSON.parse(opts.body as string) as Record<string, unknown>;

    // Without the fix: body.repo is undefined (searchProxyArgs omits repo entirely)
    // With the fix: body.repo === "owner/testrepo"
    expect(body["repo"]).toBe("owner/testrepo");
  });
});
