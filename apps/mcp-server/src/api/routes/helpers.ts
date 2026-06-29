/**
 * Shared route helpers: the graph-extraction LLM caller, and the post-ingest
 * producers that drop events on the Floor event bus (pipeline.events). The GitHub
 * webhook + its agent forwarders moved to the Floor; mcp-server only emits the
 * `internal.*` projection triggers now.
 */

import type { Pool } from "pg";
import { Llm, insertEvent } from "@re-cinq/lore-shared";

/**
 * Build a graph LLM call function for extractAndUpdateGraph, routed through the
 * shared `Llm` singleton (cost logging happens inside the provider via
 * `Llm.configure`). Returns undefined when no Anthropic key is set — preserving
 * the "skip graph extraction without credentials" gate.
 */
export function makeGraphLlmCall(_pool: Pool | null): ((prompt: string) => Promise<string>) | undefined {
  if (!process.env.ANTHROPIC_API_KEY) return undefined;
  return (prompt: string) =>
    Llm.instance.complete({ prompt, jobName: "graph-extraction" }).then((r) => r.text);
}

// ── Post-ingest producers (Floor event bus) ─────────────────────────

/**
 * Project specs/adrs into the spec-trace graph: emit an `internal.ingest.spec_trace`
 * event. The Floor loop's handler runs dispatchSpecTrace, which reads the repo for
 * these doc kinds. (Test-report projection moved to the Floor ci-tests ingress, fed
 * by the lore-code-trace binary.) No dedupe key — projection is content-hash
 * idempotent, so a `force` re-ingest must not be collapsed away. No-op without a pool.
 */
export async function triggerAgentSpecTrace(pool: Pool | null, repo: string, kind: string, payload: unknown): Promise<void> {
  if (!pool) return;
  await insertEvent(pool, {
    eventName: "internal.ingest.spec_trace",
    source: "internal",
    params: { repo, kind, payload },
  }).catch((err) => console.warn("[spec-trace] event insert failed:", (err as Error).message));
}

/**
 * Validate a repo's inline spec→test links after an ingest: emit an
 * `internal.ingest.spec_coverage_validate` event. The Floor loop's handler runs
 * validateSpecCoverageJob. No-op when there's no DB pool.
 */
export async function triggerAgentSpecCoverageValidate(pool: Pool | null, repo: string): Promise<void> {
  if (!pool) return;
  await insertEvent(pool, {
    eventName: "internal.ingest.spec_coverage_validate",
    source: "internal",
    params: { repo },
  }).catch((err) => console.warn("[spec-coverage-validate] event insert failed:", (err as Error).message));
}
