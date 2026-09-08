/** Derive Statement status from TraceLink evidence tiers; untested when no links (Phase 4/T242). */

import type { DgraphClientPort } from "../../outbound/spec-trace/deps.js";
import { withTxn } from "../../outbound/spec-trace/dgraph-upsert.js";
import { highestTier, type EvidenceTier } from "./trace-link.js";

export type StatementStatus = "verified-implemented" | "claimed" | "untested";

async function fetchEvidenceTiers(
  dgraph: DgraphClientPort,
  statementXid: string,
): Promise<EvidenceTier[]> {
  return withTxn(dgraph, async (txn) => {
    const res = await txn.queryWithVars(
      `query q($sx: string){ stmt(func: eq(Statement.xid, $sx)){ Statement.trace_links { TraceLink.evidence } } }`,
      { $sx: statementXid },
    );
    const { stmt } = res.data as {
      stmt?: Array<Record<string, unknown>>;
    };
    const links = (stmt?.[0]?.["Statement.trace_links"] ?? []) as Array<{
      "TraceLink.evidence"?: EvidenceTier;
    }>;

    return links
      .map((link) => link["TraceLink.evidence"])
      .filter((tier): tier is EvidenceTier => tier !== undefined);
  });
}

function classifyTier(top: EvidenceTier | undefined): StatementStatus {
  if (top === "execution-verified" || top === "generated-provenance") {
    return "verified-implemented";
  }

  if (top === "human-linked" || top === "coverage-bridged") {
    return "claimed";
  }

  return "untested";
}

export async function deriveStatementStatus(
  dgraph: DgraphClientPort,
  statementXid: string,
): Promise<StatementStatus> {
  const tiers = await fetchEvidenceTiers(dgraph, statementXid);

  return classifyTier(highestTier(tiers));
}
