/** Graph baseline commit; ranges recorded against one commit; pre-merge query must know which to sound. */

import type { DgraphClientPort } from "./deps.js";
import { withTxn, upsertByXid } from "./dgraph-upsert.js";

export interface GraphBaseline {
  commit: string | null;
  /** ISO-8601 wall-clock time the stamp was written (ingest time, not commit date). */
  at: string | null;
  source: "repo-stamp" | "none";
}

const NO_BASELINE: GraphBaseline = { commit: null, at: null, source: "none" };

const BASELINE_QUERY = `query q($xid: string) {
  repos(func: eq(Repo.xid, $xid)) {
    Repo.trace_commit
    Repo.trace_commit_at
  }
}`;

interface GraphRepoBaseline {
  "Repo.trace_commit"?: string;
  "Repo.trace_commit_at"?: string;
}

/** Reads repo's stamped baseline; unstamped repos return source: "none" rather than error. */
export async function readGraphBaseline(
  dgraph: DgraphClientPort,
  repo: string,
): Promise<GraphBaseline> {
  const repos = await withTxn(dgraph, async (txn) => {
    const res = await txn.queryWithVars(BASELINE_QUERY, { $xid: repo });

    return (res.data.repos ?? []) as GraphRepoBaseline[];
  });
  const commit = repos[0]?.["Repo.trace_commit"];

  if (!commit) {
    return NO_BASELINE;
  }

  return {
    commit,
    at: repos[0]?.["Repo.trace_commit_at"]
      ? new Date(repos[0]["Repo.trace_commit_at"]).toISOString()
      : null,
    source: "repo-stamp",
  };
}

/** Stamps repo with commit for its ranges; empty commit is no-op to avoid blanking older baseline. */
export async function stampGraphBaseline(
  dgraph: DgraphClientPort,
  repo: string,
  commit: string,
  at: Date,
): Promise<void> {
  if (!commit) {
    return;
  }

  await upsertByXid(dgraph, "Repo", repo, {
    "Repo.trace_commit": commit,
    "Repo.trace_commit_at": at.toISOString(),
  });
}
