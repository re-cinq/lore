import { describe, it, expect } from "vitest";
import { handleGraphIngest } from "./graph-ingest-handler.js";

/**
 * handleGraphIngest drives a graph-ingest task through its DB status lifecycle
 * so the UI reflects the run. Exercised with a fake pool (captures SQL) + a fake
 * repo reader + a null dgraph client — no live Dgraph: runIngestGraph
 * short-circuits to a "skipped" summary, and the task still ends "completed".
 */

function fakePool() {
  const events: Array<{ from: unknown; to: unknown; meta: unknown }> = [];
  const statuses: string[] = [];
  let contextMerged: unknown;
  const pool = {
    query: async (text: string, params?: unknown[]) => {
      if (text.includes("task_events")) {
        events.push({ from: params?.[1], to: params?.[2], meta: params?.[3] });
      } else if (text.includes("UPDATE pipeline.tasks SET status")) {
        statuses.push(String(params?.[0]));
      } else if (text.includes("context_bundle")) {
        contextMerged = params?.[0];
      }
      return { rows: [] };
    },
  };
  return { pool, events, statuses, get contextMerged() { return contextMerged; } };
}

const fakeProject = {
  repo: {
    tree: async () => ["specs/auth/spec.md"],
    read: async () => "# Spec\n\nThe widget works.",
  },
};

describe("handleGraphIngest", () => {
  it("transitions queued→running→completed and records the summary when no dgraph is configured", async () => {
    const f = fakePool();

    const summary = await handleGraphIngest(
      { id: "task-1", context_bundle: { kind: "specs" } },
      "o/r",
      "agent-1",
      { pool: f.pool, project: fakeProject, dgraph: null },
    );

    expect(summary.status).toBe("skipped");
    expect(f.statuses).toEqual(["queued", "running", "completed"]);
    expect(f.events.map((e) => [e.from, e.to])).toEqual([
      ["pending", "queued"],
      ["queued", "running"],
      ["running", "completed"],
    ]);
    expect(String(f.contextMerged)).toContain("ingest_summary");
  });
});
