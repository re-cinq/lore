/** The traceability graph's retention reap: overlays whose run never dropped them, and failures old enough that the retrospective episode carries the lesson instead. */

import type { DgraphClientPort } from "../../outbound/spec-trace/deps.js";
import { pruneOverlays } from "./overlay.js";
import { pruneFailures } from "./failure-nodes.js";

/** Matches the `agent_run_events` window, so run-scoped graph data and run-scoped telemetry age out together. */
export const GRAPH_RETENTION_DAYS = 14;

/** What one reap removed, per kind, so the caller can log it. */
export interface GraphRetentionResult {
  overlays: number;
  failures: number;
}

/** The instant `days` ago — the cutoff both reaps compare against. */
export function retentionCutoff(now: Date, days: number): Date {
  return new Date(now.getTime() - days * 24 * 60 * 60 * 1000);
}

/** Reaps one repo's expired overlays and failures. Each kind is reaped independently: one failing must not leave the other unreaped. */
export async function pruneGraphRetention(
  dgraph: DgraphClientPort,
  repo: string,
  opts: { now?: Date; days?: number } = {},
): Promise<GraphRetentionResult> {
  const cutoff = retentionCutoff(
    opts.now ?? new Date(),
    opts.days ?? GRAPH_RETENTION_DAYS,
  );
  const [overlays, failures] = await Promise.allSettled([
    pruneOverlays(dgraph, repo, cutoff),
    pruneFailures(dgraph, repo, cutoff),
  ]);

  return { overlays: countOf(overlays), failures: countOf(failures) };
}

/** A reap that threw removed nothing; the count says so rather than propagating, because housekeeping must never fail the ingest it rides on. */
function countOf(result: PromiseSettledResult<number>): number {
  return result.status === "fulfilled" ? result.value : 0;
}
