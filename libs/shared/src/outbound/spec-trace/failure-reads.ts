/** The read side of failure nodes (issue #1771): what has failed on a file before, newest first, each with the sha that ended it. Lives in outbound so the trace port can serve it; the writes stay in work/spec-trace/failure-nodes.ts. */

import type { DgraphClientPort } from "./deps.js";
import { withTxn } from "./dgraph-upsert.js";

/** A past failure on a file, as `fix-ci` reads it back. */
export interface FailureHit {
  stationRunId: string;
  nodeId: string;
  iteration: number;
  failureClass: string;
  failureDetail: string;
  commit: string;
  occurredAt: string;
  /** The sha of the attempt that went green where this one failed; absent while the failure still stands. */
  resolvedByCommit?: string;
}

/** Every failure recorded against `path`, newest first, each carrying the sha that ended it when one did. */
export async function failuresTouching(
  dgraph: DgraphClientPort,
  repo: string,
  path: string,
): Promise<FailureHit[]> {
  const rows = await withTxn(dgraph, async (txn) => {
    const res = await txn.queryWithVars(TOUCHING_QUERY, {
      $xid: `${repo}|${path}`,
    });
    const files = (res.data.f ?? []) as {
      failures?: GraphFailure[];
    }[];

    return files.flatMap((file) => file.failures ?? []);
  });

  return rows.map(toHit);
}

interface GraphFailure {
  "Failure.station_run_id"?: string;
  "Failure.node_id"?: string;
  "Failure.iteration"?: number;
  "Failure.failure_class"?: string;
  "Failure.failure_detail"?: string;
  "Failure.commit"?: string;
  "Failure.occurred_at"?: string;
  "Failure.resolved_by_commit"?: string;
}

const FAILURE_FIELDS = `Failure.station_run_id
      Failure.node_id
      Failure.iteration
      Failure.failure_class
      Failure.failure_detail
      Failure.commit
      Failure.occurred_at
      Failure.resolved_by_commit`;

const TOUCHING_QUERY = `query q($xid: string) {
  f(func: eq(File.xid, $xid)) {
    failures: ~Failure.files (orderdesc: Failure.occurred_at) {
      ${FAILURE_FIELDS}
    }
  }
}`;

const HIT_FIELDS = [
  ["stationRunId", "Failure.station_run_id"],
  ["nodeId", "Failure.node_id"],
  ["failureClass", "Failure.failure_class"],
  ["failureDetail", "Failure.failure_detail"],
  ["commit", "Failure.commit"],
  ["occurredAt", "Failure.occurred_at"],
] as const;

function toHit(row: GraphFailure): FailureHit {
  const resolved = row["Failure.resolved_by_commit"];
  const strings = Object.fromEntries(
    HIT_FIELDS.map(([field, predicate]) => [field, row[predicate] ?? ""]),
  ) as Omit<FailureHit, "iteration" | "resolvedByCommit">;

  return {
    ...strings,
    iteration: row["Failure.iteration"] ?? 0,
    ...(resolved ? { resolvedByCommit: resolved } : {}),
  };
}
