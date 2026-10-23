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

describe("lore_assemble_context audit logging", () => {
  it("logs query, template, sources hit, and tokens to console.error after a successful proxy call", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => ({
        ok: true,
        json: async () => ({
          text: "assembled context block",
          trace: {
            sections: [
              { source: "conventions", budget: 2000, returnedTokens: 400 },
              { source: "memories", budget: 1000, returnedTokens: 150 },
            ],
          },
        }),
      })),
    );

    const logSpy = vi.spyOn(console, "error").mockImplementation(() => {});

    await assembleContext({
      query: "auth flow",
      template: "review",
      repo: "owner/repo",
    });

    const logs = logSpy.mock.calls.map((call) => call.join(" ")).join("\n");

    expect(logs).toMatch(/query: auth flow[\s\S]*template: review/);
    expect(logs).toMatch(/sources hit:.*conventions/i);
    expect(logs).toMatch(/tokens:.*550/i);
  });
});
