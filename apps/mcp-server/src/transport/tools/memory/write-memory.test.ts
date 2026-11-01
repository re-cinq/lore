import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { toolHandlers } from "../shared/tool-test-helpers.js";
import { registerWriteMemoryTool } from "./write-memory.js";

const home = await vi.hoisted(async () => {
  const { mkdtempSync } = await import("node:fs");
  const { tmpdir } = await import("node:os");

  process.env.HOME = mkdtempSync(`${tmpdir()}/lore-write-memory-`);

  return process.env.HOME;
});
const fetchMock = vi.fn();
const writeMemory = toolHandlers(registerWriteMemoryTool, "full")[
  "lore_write_memory"
];

beforeEach(() => {
  vi.stubEnv("LORE_API_URL", "https://lore-api.example.com");
  vi.stubEnv("LORE_INGEST_TOKEN", "tok");
  fetchMock.mockReset();
  vi.stubGlobal("fetch", fetchMock);
});
afterEach(() => {
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
});

describe("lore_write_memory remote proxy (no local DB)", () => {
  it("returns the proxied body on a successful write", async () => {
    fetchMock.mockResolvedValue({
      ok: true,
      json: async () => ({ key: "k", version: 1 }),
    });

    const result = await writeMemory({ key: "k", value: "v" });

    expect(JSON.parse(result.content[0].text)).toEqual({
      key: "k",
      version: 1,
    });
  });

  it("reports a denied error on a 401 to a memory write without retrying", async () => {
    fetchMock.mockResolvedValue({
      ok: false,
      status: 401,
      statusText: "Unauthorized",
      text: async () => "",
    });

    const result = await writeMemory({ key: "k", value: "v" });

    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(result.content[0].text).toContain("denied");
  });

  it("in the agent gateway scopes the write to the repo the call names", async () => {
    const agentWrite = toolHandlers(registerWriteMemoryTool, "agent")[
      "lore_write_memory"
    ];

    fetchMock.mockResolvedValue({ ok: true, json: async () => ({}) });

    await agentWrite({ key: "k", value: "v", repo: "re-cinq/lore" });

    expect(
      JSON.parse((fetchMock.mock.calls[0][1] as { body: string }).body),
    ).toMatchObject({ action: "write", key: "k", repo: "re-cinq/lore" });
  });

  it("in the agent gateway sends no repo when the call names none", async () => {
    const agentWrite = toolHandlers(registerWriteMemoryTool, "agent")[
      "lore_write_memory"
    ];

    fetchMock.mockResolvedValue({ ok: true, json: async () => ({}) });

    await agentWrite({ key: "k", value: "v" });

    expect(
      JSON.parse((fetchMock.mock.calls[0][1] as { body: string }).body),
    ).not.toHaveProperty("repo");
  });

  it("reports a 400 as the API rejecting the call with its reason, not as an unreachable API", async () => {
    fetchMock.mockResolvedValue({
      ok: false,
      status: 400,
      statusText: "Bad Request",
      text: async () => JSON.stringify({ error: "key: required" }),
    });

    const result = await writeMemory({ key: "k", value: "v" });

    expect(result.content[0].text).toBe(
      "Lore API rejected lore_write_memory: HTTP 400 Bad Request: key: required",
    );
  });

  it("rejects the repo ../lore before any API call", async () => {
    const result = await writeMemory({ key: "k", value: "v", repo: "../lore" });

    expect({
      text: result.content[0].text,
      proxied: fetchMock.mock.calls.length,
    }).toEqual({
      text: "Invalid repo '../lore'. Pass repo as owner/name (e.g. 're-cinq/lore').",
      proxied: 0,
    });
  });
});

describe("lore_write_memory with no API configured", () => {
  it("writes key offline-key to the file store and returns version 1", async () => {
    vi.stubEnv("LORE_API_URL", "");

    const result = await writeMemory({
      key: "offline-key",
      value: "v",
      agent_id: "agent-offline",
    });

    expect(JSON.parse(result.content[0].text)).toMatchObject({
      key: "offline-key",
      version: 1,
    });
  });

  it("reports the file store's failure when the agent's directory is a plain file", async () => {
    mkdirSync(join(home, ".lore", "memory"), { recursive: true });
    writeFileSync(join(home, ".lore", "memory", "agent-broken"), "");
    vi.stubEnv("LORE_API_URL", "");

    const result = await writeMemory({
      key: "k",
      value: "v",
      agent_id: "agent-broken",
    });

    expect(result.content[0].text).toMatch(/^Error writing memory: /);
  });
});
