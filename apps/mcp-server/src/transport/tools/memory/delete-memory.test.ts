import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import {
  readMemoryFile,
  writeMemoryFile,
} from "@re-cinq/lore-server-core/features/memory/memory-file.js";
import { toolHandlers } from "../shared/tool-test-helpers.js";
import { registerDeleteMemoryTool } from "./delete-memory.js";

const home = await vi.hoisted(async () => {
  const { mkdtempSync } = await import("node:fs");
  const { tmpdir } = await import("node:os");

  process.env.HOME = mkdtempSync(`${tmpdir()}/lore-delete-memory-`);

  return process.env.HOME;
});
const fetchMock = vi.fn();
const deleteMemory = toolHandlers(registerDeleteMemoryTool, "full")[
  "lore_delete_memory"
];

beforeEach(() => {
  vi.stubEnv("LORE_API_URL", "https://lore-api.example.com");
  vi.stubEnv("LORE_INGEST_TOKEN", "tok");
  vi.stubEnv("LORE_AGENT_ID", "agent-ambient");
  fetchMock.mockReset();
  vi.stubGlobal("fetch", fetchMock);
});
afterEach(() => {
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
});

describe("lore_delete_memory remote proxy (no local DB)", () => {
  it("sends the delete of key k for the ambient agent agent-ambient and returns the API's answer", async () => {
    fetchMock.mockResolvedValue({
      ok: true,
      json: async () => ({ key: "k", deleted: true }),
    });

    const result = await deleteMemory({ key: "k" });

    expect({
      sent: JSON.parse((fetchMock.mock.calls[0][1] as { body: string }).body),
      printed: JSON.parse(result.content[0].text),
    }).toMatchObject({
      sent: { action: "delete", key: "k", agent_id: "agent-ambient" },
      printed: { key: "k", deleted: true },
    });
  });

  it("reports a denied error on a 403", async () => {
    fetchMock.mockResolvedValue({
      ok: false,
      status: 403,
      statusText: "Forbidden",
      text: async () => "",
    });

    const result = await deleteMemory({ key: "k", agent_id: "agent-x" });

    expect(result.content[0].text).toContain("denied");
  });
});

describe("lore_delete_memory with no API configured", () => {
  beforeEach(() => {
    vi.stubEnv("LORE_API_URL", "");
  });

  it("soft-deletes key stale from the file store so a read no longer finds it", async () => {
    writeMemoryFile("stale", "v", "agent-delete");

    const result = await deleteMemory({
      key: "stale",
      agent_id: "agent-delete",
    });

    expect({
      printed: JSON.parse(result.content[0].text),
      readBack: readMemoryFile("stale", "agent-delete"),
    }).toEqual({ printed: { key: "stale", deleted: true }, readBack: null });
  });

  it("reports a store whose memories.json holds null as a delete error", async () => {
    const dir = join(home, ".lore", "memory", "agent-null");

    mkdirSync(dir, { recursive: true });
    writeFileSync(join(dir, "memories.json"), "null");

    const result = await deleteMemory({ key: "k", agent_id: "agent-null" });

    expect(result.content[0].text).toMatch(/^Error deleting memory: /);
  });
});
