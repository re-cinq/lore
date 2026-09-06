import { describe, it, expect } from "vitest";
import { Memory } from "./memory.js";
import type {
  MemoryPort,
  MemoryRecord,
  MemoryWriteResult,
} from "./memory-port.js";

function fakeMemory(): MemoryPort {
  const rows = new Map<string, MemoryRecord>();
  const keyOf = (repo: string, agentId: string, key: string) =>
    `${repo}|${agentId}|${key}`;

  return {
    write: async (repo, key, value, agentId): Promise<MemoryWriteResult> => {
      const prev = rows.get(keyOf(repo, agentId, key));
      const version = (prev?.version ?? 0) + 1;

      rows.set(keyOf(repo, agentId, key), { key, value, version });

      return { key, version };
    },
    read: async (repo, key, agentId) =>
      rows.get(keyOf(repo, agentId, key)) ?? null,
    list: async (repo, agentId) =>
      [...rows.entries()]
        .filter(([k]) => k.startsWith(`${repo}|${agentId}|`))
        .map(([, v]) => v),
  };
}

describe("Memory", () => {
  it("writes then reads back the value for the repo", async () => {
    const facade = new Memory("re-cinq/lore", fakeMemory());

    const written = await facade.write(
      "deploy-gotcha",
      "use --set-string",
      "agent-1",
    );
    const read = await facade.read("deploy-gotcha", "agent-1");

    expect(written).toEqual({ key: "deploy-gotcha", version: 1 });
    expect(read).toEqual({
      key: "deploy-gotcha",
      value: "use --set-string",
      version: 1,
    });
  });

  it("isolates memories of a different repo", async () => {
    const shared = fakeMemory();
    const lore = new Memory("re-cinq/lore", shared);
    const other = new Memory("other/repo", shared);

    await lore.write("k", "lore-value", "agent-1");

    expect(await other.read("k", "agent-1")).toBeNull();
  });
});
