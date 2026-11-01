import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { writeMemoryFile } from "@re-cinq/lore-server-core/features/memory/memory-file.js";
import { toolHandlers } from "../shared/tool-test-helpers.js";
import { registerReadMemoryTool } from "./read-memory.js";

const home = await vi.hoisted(async () => {
  const { mkdtempSync } = await import("node:fs");
  const { tmpdir } = await import("node:os");

  process.env.HOME = mkdtempSync(`${tmpdir()}/lore-read-memory-`);

  return process.env.HOME;
});
const fetchMock = vi.fn();
const readMemory = toolHandlers(registerReadMemoryTool, "full")[
  "lore_read_memory"
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

describe("lore_read_memory remote proxy (no local DB)", () => {
  it("returns the proxied body on a successful read", async () => {
    fetchMock.mockResolvedValue({
      ok: true,
      json: async () => ({ key: "k", value: "v" }),
    });

    const result = await readMemory({ key: "k" });

    expect(JSON.parse(result.content[0].text)).toEqual({
      key: "k",
      value: "v",
    });
  });

  it("reports a denied error on a 401 to a memory read without retrying", async () => {
    fetchMock.mockResolvedValue({
      ok: false,
      status: 401,
      statusText: "Unauthorized",
      text: async () => "",
    });

    const result = await readMemory({ key: "k" });

    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(result.content[0].text).toContain("denied");
  });
});

describe("lore_read_memory with no API configured", () => {
  beforeEach(() => {
    vi.stubEnv("LORE_API_URL", "");
    writeMemoryFile("deploy-day", "friday", "agent-read");
    writeMemoryFile("deploy-day", "monday", "agent-read");
  });

  it("returns the latest value monday of key deploy-day from the file store", async () => {
    const result = await readMemory({
      key: "deploy-day",
      agent_id: "agent-read",
    });

    expect(JSON.parse(result.content[0].text)).toMatchObject({
      key: "deploy-day",
      value: "monday",
    });
  });

  it("returns value friday for version 1", async () => {
    const result = await readMemory({
      key: "deploy-day",
      agent_id: "agent-read",
      version: "1",
    });

    expect(JSON.parse(result.content[0].text)).toMatchObject({
      value: "friday",
    });
  });

  it("returns both values for version all", async () => {
    const result = await readMemory({
      key: "deploy-day",
      agent_id: "agent-read",
      version: "all",
    });

    expect(result.content[0].text).toMatch(/monday[\s\S]*friday/);
  });

  it("reports key never-written as not found", async () => {
    const result = await readMemory({
      key: "never-written",
      agent_id: "agent-read",
    });

    expect(result.content[0].text).toBe('Memory "never-written" not found.');
  });

  it("reports a store whose memories.json holds null as a read error", async () => {
    const dir = join(home, ".lore", "memory", "agent-null");

    mkdirSync(dir, { recursive: true });
    writeFileSync(join(dir, "memories.json"), "null");

    const result = await readMemory({ key: "k", agent_id: "agent-null" });

    expect(result.content[0].text).toMatch(/^Error reading memory: /);
  });
});
