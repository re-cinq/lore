import { describe, it, expect } from "vitest";
import { selectOrphanedIngestTasks } from "./reclaim-orphaned-ingest.js";

/**
 * Orphan-on-deploy recovery: when a pod roll strands a graph-ingest task in
 * `running`, this picks the ones idle past the threshold so the job can reset
 * them to `pending` and let the agent re-run them (idempotent — content_hash
 * skips already-projected files). Non-graph-ingest (LLM) tasks are NOT reclaimed
 * here — they go to the 6h human-escalation path so a genuinely broken task
 * doesn't re-run-loop.
 */
const GRAPH_TYPES = new Set(["ingest-tests"]);

describe("selectOrphanedIngestTasks", () => {
  it("selects a graph-ingest task idle past the threshold", () => {
    expect(
      selectOrphanedIngestTasks([{ id: "t1", task_type: "ingest-tests", idle_minutes: 20 }], GRAPH_TYPES, 15),
    ).toEqual(["t1"]);
  });

  it("ignores a graph-ingest task still within the threshold (legitimately running)", () => {
    expect(
      selectOrphanedIngestTasks([{ id: "t1", task_type: "ingest-tests", idle_minutes: 3 }], GRAPH_TYPES, 15),
    ).toEqual([]);
  });

  it("ignores non-graph-ingest tasks (left for the 6h human-escalation path)", () => {
    expect(
      selectOrphanedIngestTasks([{ id: "t1", task_type: "general", idle_minutes: 120 }], GRAPH_TYPES, 15),
    ).toEqual([]);
  });
});
