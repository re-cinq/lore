import { describe, it, expect } from "vitest";
import { MemoryStoreBridge } from "./memory-store-bridge.js";
import type { MemoryStore } from "../../memory-store.js";

function fakeStore(): MemoryStore {
  const rows = new Map<
    string,
    { key: string; value: string; version: number; repo?: string }
  >();

  return {
    backend: "postgres",
    writeMemory: async ({ key, value, agentId, repo }) => {
      const prev = rows.get(`${repo}|${key}`);
      const version = (prev?.version ?? 0) + 1;

      rows.set(`${repo}|${key}`, { key, value, version, repo });

      return { key, version, agent_id: agentId, created_at: "now" };
    },
    readMemory: async (key, _agentId) => {
      for (const r of rows.values()) {
        if (r.key === key) {
          return r;
        }
      }

      return null;
    },
    deleteMemory: async (key) => ({ key, deleted: true }),
    listMemories: async ({ repo }) => {
      const memories = [...rows.values()].filter((r) => r.repo === repo);

      return { memories, total: memories.length };
    },
  };
}

describe("MemoryStoreBridge", () => {
  it("writes through the seam and returns key + version", async () => {
    const bridge = new MemoryStoreBridge(fakeStore());

    expect(await bridge.write("re-cinq/lore", "k", "v", "agent-1")).toEqual({
      key: "k",
      version: 1,
    });
  });

  it("lists only the repo's memories from the seam", async () => {
    const bridge = new MemoryStoreBridge(fakeStore());

    await bridge.write("re-cinq/lore", "k", "v", "agent-1");

    expect(await bridge.list("re-cinq/lore", "agent-1")).toEqual([
      { key: "k", value: "v", version: 1 },
    ]);
  });
});
