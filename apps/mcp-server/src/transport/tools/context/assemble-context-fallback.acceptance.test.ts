import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { toolHandlers, type ToolHandler } from "../shared/tool-test-helpers.js";
import { registerAssembleContextTool } from "./assemble-context.js";

let assembleContext: ToolHandler;

beforeEach(() => {
  const handlers = toolHandlers(registerAssembleContextTool, "full");

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

describe("T028: Log context assemblies to audit log (fallback condition)", () => {
  it("Logs the resolved template used after unknown-name fallback", async () => {
    const fetchMock = vi.fn(async () => ({
      ok: true,
      json: async () => ({
        text: "<context></context>",
        sections: [{ header: "code", tokens: 100, truncated: false }],
        template: "default",
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

    expect(logs).toMatch(/template: default/);
    expect(logs).not.toMatch(/template: implementation/);
  });
});
