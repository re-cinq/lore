import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { toolHandlers, type ToolHandler } from "./tool-test-helpers.js";
import { registerContextTools } from "./context-tools.js";

let assembleContext: ToolHandler;

beforeEach(() => {
  const handlers = toolHandlers(registerContextTools, "full");

  assembleContext = handlers["lore_assemble_context"];
  process.env.LORE_API_URL = "https://lore.example";
  process.env.LORE_INGEST_TOKEN = "test-token";
});

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
  delete process.env.LORE_API_URL;
  delete process.env.LORE_INGEST_TOKEN;
});

describe("T011: Expose assembly as an MCP Tool", () => {
  it("Tool is visible via MCP listings", () => {
    expect(assembleContext).toBeDefined();
  });

  it("Executes successfully end-to-end", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => ({
        ok: true,
        json: async () => ({ text: "MOCKED ASSEMBLED CONTEXT" }),
      })),
    );

    const result = await assembleContext({
      query: "auth middleware",
      template: "implementation",
      repo: "owner/repo",
    });

    expect(result.content[0].text).toContain("MOCKED ASSEMBLED CONTEXT");
  });

  it("Logging captures call variables: query, template used, sources hit, total tokens returned", async () => {
    const fetchMock = vi.fn(async () => ({
      ok: true,
      json: async () => ({
        text: '<context><section name="Code" source="code"></section></context>',
        sections: [{ header: "code", tokens: 250, truncated: false }],
      }),
    }));

    vi.stubGlobal("fetch", fetchMock);

    const logSpy = vi.spyOn(console, "error").mockImplementation(() => {});

    await assembleContext({
      query: "auth middleware",
      template: "implementation",
      repo: "owner/repo",
    });

    const logs = logSpy.mock.calls.map((call) => call.join(" ")).join("\n");

    expect(logs).toMatch(
      /query: auth middleware[\s\S]*template: implementation/,
    );
    expect(logs).toMatch(/sources hit:.*code/i);
    expect(logs).toMatch(/tokens:.*250/i);
  });
});
