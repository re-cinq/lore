/** Route helpers: graph-extraction LLM caller and post-ingest event bus producers. */

import type { Pool } from "pg";
import { Llm } from "@re-cinq/lore-shared";
import { eventProxyFor } from "./event-reporter.js";

/** Graph LLM caller via shared Llm singleton; undefined when Anthropic key is missing. */
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

/** Projects specs/adrs to spec-trace graph; content-hash idempotent, no force collapse. */
export async function triggerAgentSpecTrace(
  pool: Pool | null,
  repo: string,
  kind: string,
  payload: unknown,
): Promise<void> {
  if (!pool) {
    return;
  }
  // Queued: both callers use `void`, swallowing failures.
  await eventProxyFor(pool).emit({
    kind: "event",
    event: {
      eventName: "internal.ingest.spec_trace",
      source: "internal",
      params: { repo, kind, payload },
    },
  });
}

/** Validates inline spec→test links after ingest; no-op without pool. */
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
