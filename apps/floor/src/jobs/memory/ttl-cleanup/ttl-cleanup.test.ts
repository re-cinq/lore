import { describe, it, expect } from "vitest";
import { InMemoryMemoryLifecycle, type MemoryRow } from "@re-cinq/lore-shared/project/memory/memory-lifecycle-memory.js";
import { ttlCleanupJob } from "./ttl-cleanup.js";

function expiredMemory(id: string): MemoryRow {
  return {
    id,
    agent_id: "agent",
    key: `k-${id}`,
    value: "v",
    version: 1,
    is_deleted: false,
    created_at: "2026-01-01T00:00:00Z",
    last_retrieved_at: null,
    half_life_days: null,
    retrieval_count: null,
    expires_at: "2026-01-02T00:00:00Z",
  };
}

describe("ttlCleanupJob", () => {
  it("soft-deletes expired memories and reports the count", async () => {
    const memory = new InMemoryMemoryLifecycle({
      memories: [expiredMemory("1"), expiredMemory("2"), expiredMemory("3")],
    });

    expect(await ttlCleanupJob(memory)).toBe("Cleaned up 3 expired memories");
    expect(memory.memories.every((m) => m.is_deleted)).toBe(true);
  });

  it("reports zero when nothing is expired", async () => {
    expect(await ttlCleanupJob(new InMemoryMemoryLifecycle())).toBe("Cleaned up 0 expired memories");
  });
});
