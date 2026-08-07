/**
 * graph-baseline — the commit whose line numbering the trace graph's ranges are
 * expressed in.
 *
 * Every line range in the graph (`Coverage.covers|ranges`, `TestChunk.start_line`)
 * was recorded against one commit of the repo. A pre-merge query that overlaps
 * those ranges against a PR diff is only sound if it knows which commit that was
 * — otherwise it silently compares two different coordinate systems and drifts
 * into both false positives and false negatives.
 *
 * Deliberately NOT named `last_ingest_*`: "ingest" already means the pgvector
 * reindex (`lore.repos.last_ingested_at`) and the specs/adrs doc projection,
 * neither of which defines these coordinates.
 */

import type { DgraphClientPort } from "./deps.js";
import { withTxn, upsertByXid } from "./dgraph-upsert.js";

export interface GraphBaseline {
  commit: string | null;
  /** ISO-8601, or null when the repo has never been stamped. */
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

/**
 * Reads the repo's stamped baseline. A repo that has never been stamped — or one
 * whose stamp predates this feature — reads back as `source: "none"` rather than
 * an error, so a caller degrades to "coordinates unverified" instead of failing.
 */
export async function readGraphBaseline(
  dgraph: DgraphClientPort,
  repo: string,
): Promise<GraphBaseline> {
  const repos = await withTxn(dgraph, async (txn) => {
    const res = await txn.queryWithVars(BASELINE_QUERY, { $xid: repo });

    return (res.data?.repos ?? []) as GraphRepoBaseline[];
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

/**
 * Stamps the repo with the commit its freshly-written ranges belong to. Called
 * by the ingest that writes those ranges, so the stamp cannot disagree with the
 * data it describes.
 *
 * An empty commit is a no-op, not a write: several callers default the field to
 * `""`, and blanking a good baseline would be strictly worse than keeping a
 * slightly older true one.
 */
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
