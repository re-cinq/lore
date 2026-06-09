import { describe, it, expect } from "vitest";
import { maybeAutoIngestGraph } from "./ingest-graph-tasks.js";

/**
 * maybeAutoIngestGraph gates the post-ingest fan-out on the repo's
 * settings.auto_ingest_graph flag. Exercised with a fake pool that records the
 * ingest-* task types inserted (no live DB).
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

describe("maybeAutoIngestGraph", () => {
  it("creates specs+adrs tasks when auto_ingest_graph is enabled", async () => {
    const f = fakePool({ auto_ingest_graph: true });
    await maybeAutoIngestGraph(f.pool as never, "o/r");
    expect(f.insertedTypes).toEqual(["ingest-specs", "ingest-adrs"]);
  });

  it("does nothing when the setting is off", async () => {
    const f = fakePool({ auto_ingest_graph: false });
    await maybeAutoIngestGraph(f.pool as never, "o/r");
    expect(f.insertedTypes).toEqual([]);
  });

  it("does nothing when settings are absent", async () => {
    const f = fakePool(null);
    await maybeAutoIngestGraph(f.pool as never, "o/r");
    expect(f.insertedTypes).toEqual([]);
  });
});
