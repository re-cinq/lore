import { describe, it, expect } from "vitest";
import { createIngestGraphTasks } from "./ingest-graph-tasks.js";

/**
 * createIngestGraphTasks fans out one ingest-<kind> pipeline task per requested
 * kind. Exercised with a fake pool that records the inserted task types (no live
 * DB). Docs (specs/adrs) no longer flow as tasks — they project via the CI-driven
 * spec-trace trigger — so this path is exercised for the `tests` kind.
 */
function fakePool(settings: unknown) {
  const insertedTypes: string[] = [];
  const pool = {
    query: async (text: string, params?: unknown[]) => {
      if (/SELECT settings FROM lore\.repos/.test(text)) return { rows: [{ settings }] };
      if (/INSERT INTO pipeline\.tasks/.test(text)) {
        const t = (params ?? []).find((p) => typeof p === "string" && p.startsWith("ingest-"));
        if (t) insertedTypes.push(t as string);
        return { rows: [{ id: "task-id" }] };
      }
      return { rows: [] }; // dedupe SELECT, task_events INSERT, etc.
    },
  };
  return { pool, insertedTypes };
}

describe("createIngestGraphTasks", () => {
  it("sets created[].id to the created task's task_id", async () => {
    const f = fakePool({});
    const result = await createIngestGraphTasks(f.pool as never, "o/r", { kinds: ["tests"] });
    expect(result.created).toEqual([{ id: "task-id", kind: "tests" }]);
  });
});
