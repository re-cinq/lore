/**
 * Side-effecting route helpers: the graph-extraction LLM caller and the
 * post-ingest producers that drop events on the Floor event bus
 * (pipeline.events).
 */

import type { Pool } from "pg";
import { Llm } from "@re-cinq/lore-shared";
import { eventProxyFor } from "./event-reporter.js";

/**
 * Build a graph LLM call function for extractAndUpdateGraph, routed through the
 * shared `Llm` singleton (cost logging happens inside the provider via
 * `Llm.configure`). Returns undefined when no Anthropic key is set — preserving
 * the "skip graph extraction without credentials" gate.
 */
export function makeGraphLlmCall(
  _pool: Pool | null,
): ((prompt: string) => Promise<string>) | undefined {
  if (!process.env.ANTHROPIC_API_KEY) {
    return undefined;
  }

  return (prompt: string) =>
    Llm.instance
      .complete({ prompt, jobName: "graph-extraction" })
      .then((r) => r.text);
}

// ── Post-ingest producers (Floor event bus) ─────────────────────────

/**
 * Project specs/adrs into the spec-trace graph: emit an `internal.ingest.spec_trace`
 * event. The Floor loop's handler runs dispatchSpecTrace, which reads the repo for
 * these doc kinds. (Test-report projection moved to the Floor ci-tests ingress, fed
 * by the lore-code-trace binary.) No dedupe key — projection is content-hash
 * idempotent, so a `force` re-ingest must not be collapsed away. No-op without a pool.
 */
export async function triggerAgentSpecTrace(
  pool: Pool | null,
  repo: string,
  kind: string,
  payload: unknown,
): Promise<void> {
  if (!pool) {
    return;
  }
  // Queued, not inserted. Both callers invoke this with `void` and it swallowed
  // its own failure on top of that, so a router blip lost the projection with
  // nothing left to notice — the ingest route's own status never reflected it.
  await eventProxyFor(pool).emit({
    kind: "event",
    event: {
      eventName: "internal.ingest.spec_trace",
      source: "internal",
      params: { repo, kind, payload },
    },
  });
}

/**
 * Validate a repo's inline spec→test links after an ingest: emit an
 * `internal.ingest.spec_coverage_validate` event. The Floor loop's handler runs
 * validateSpecCoverageJob. No-op when there's no DB pool.
 */
export async function triggerAgentSpecCoverageValidate(
  pool: Pool | null,
  repo: string,
): Promise<void> {
  if (!pool) {
    return;
  }
  await eventProxyFor(pool).emit({
    kind: "event",
    event: {
      eventName: "internal.ingest.spec_coverage_validate",
      source: "internal",
      params: { repo },
    },
  });
}
