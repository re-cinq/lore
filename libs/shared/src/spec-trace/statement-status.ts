/**
 * spec-traceability-graph Phase 4 / T242 — derives a Statement's STATUS from
 * its TraceLink evidence tiers.
 *
 * KERNEL facet: a Statement with NO TraceLinks derives to "untested". The
 * `claimed` / `verified-implemented` branches are triangulated in by later
 * cycles; the structure here leaves a single seam (the `top` tier) for them.
 */

import type { DgraphClientPort } from "./deps.js";
import { withTxn } from "./dgraph-upsert.js";
import { highestTier, type EvidenceTier } from "./trace-link.js";

export type StatementStatus = "verified-implemented" | "claimed" | "untested";

export async function deriveStatementStatus(
  dgraph: DgraphClientPort,
  statementXid: string,
): Promise<StatementStatus> {
  const tiers = await withTxn(dgraph, async (txn) => {
    const res = await txn.queryWithVars(
      `query q($sx: string){ stmt(func: eq(Statement.xid, $sx)){ Statement.trace_links { TraceLink.evidence } } }`,
      { $sx: statementXid },
    );
    const links = (res.data?.stmt?.[0]?.["Statement.trace_links"] ??
      []) as Array<{
      "TraceLink.evidence"?: EvidenceTier;
    }>;

    return links
      .map((link) => link["TraceLink.evidence"])
      .filter((tier): tier is EvidenceTier => tier !== undefined);
  });

  const top = highestTier(tiers);

  if (top === undefined) {
    return "untested";
  }

  if (top === "execution-verified" || top === "generated-provenance") {
    return "verified-implemented";
  }

  if (top === "human-linked" || top === "coverage-bridged") {
    return "claimed";
  }

  return "untested";
}
