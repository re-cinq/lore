/**
 * spec-traceability-graph Phase 4 — reified TraceLink edge-evidence model.
 *
 * A TraceLink is a node sitting on the edge between a Statement (or
 * AcceptanceCriterion) and its target, carrying the link's `kind` and the
 * `evidence` tier that justifies it. {@link upsertTraceLink} writes one such
 * node idempotently (keyed on a deterministic xid) and links it back from the
 * statement via `Statement.trace_links`, leaving the direct
 * validated_by/implemented_by edge intact.
 *
 * This layer is ADDITIVE: the direct `Statement.validated_by` /
 * `implemented_by` edges remain authoritative and are not rerouted through
 * TraceLink. Evidence is monotonic-up — re-derivation only ever raises a
 * link's tier (via {@link highestTier}), never downgrades it.
 */

import type { DgraphClientPort } from "./deps.js";
import { upsertByXid, withTxn } from "./dgraph-upsert.js";
import { verifyCoverageLink } from "./verify-coverage.js";

export type EvidenceTier =
  | "execution-verified"
  | "generated-provenance"
  | "human-linked"
  | "coverage-bridged"
  | "llm-suggested";
export type TraceLinkKind = "validated_by" | "implemented_by" | "decided_by";

export interface UpsertTraceLinkArgs {
  repo: string;
  statementUid: string;
  statementXid: string;
  targetUid: string;
  targetXid: string;
  kind: TraceLinkKind;
  evidence: EvidenceTier;
}

/** Tail = the xid with the leading `${repo}|` dropped (only the first segment). */
function tailOf(xid: string, repo: string): string {
  return xid.startsWith(`${repo}|`) ? xid.slice(repo.length + 1) : xid;
}

/**
 * Upserts a reified TraceLink keyed on a deterministic xid. Evidence is
 * monotonic-up: an existing link's tier is only ever raised, never lowered,
 * so re-derivation cannot downgrade a higher-tier provenance.
 */
export async function upsertTraceLink(
  dgraph: DgraphClientPort,
  args: UpsertTraceLinkArgs,
): Promise<string> {
  const xid = `${args.repo}|${tailOf(args.statementXid, args.repo)}|${tailOf(args.targetXid, args.repo)}|${args.kind}`;
  const existing = await withTxn(dgraph, async (txn) => {
    const res = await txn.queryWithVars(
      `query q($x: string){ tl(func: eq(TraceLink.xid, $x)){ TraceLink.evidence } }`,
      { $x: xid },
    );
    return res.data?.tl?.[0]?.["TraceLink.evidence"] as EvidenceTier | undefined;
  });
  const evidence = existing ? (highestTier([existing, args.evidence]) ?? args.evidence) : args.evidence;
  const traceLinkUid = await upsertByXid(dgraph, "TraceLink", xid, {
    "TraceLink.repo": args.repo,
    "TraceLink.statement": { uid: args.statementUid },
    "TraceLink.target": { uid: args.targetUid },
    "TraceLink.kind": args.kind,
    "TraceLink.evidence": evidence,
  });
  await withTxn(dgraph, (txn) =>
    txn.mutate({
      setJson: { uid: args.statementUid, "Statement.trace_links": [{ uid: traceLinkUid }] },
      commitNow: true,
    }),
  );
  return traceLinkUid;
}

export async function projectTraceLinks(
  dgraph: DgraphClientPort,
  repo: string,
  statementXid: string,
): Promise<{ links: number }> {
  const stmt = await withTxn(dgraph, async (txn) => {
    const res = await txn.queryWithVars(
      `query q($sx: string){ stmt(func: eq(Statement.xid, $sx)){
        uid
        validated: Statement.validated_by { uid TestChunk.xid }
        implemented: Statement.implemented_by { uid CodeChunk.xid }
      } }`,
      { $sx: statementXid },
    );
    return res.data?.stmt?.[0] as
      | {
          uid: string;
          validated?: Array<{ uid: string; "TestChunk.xid": string }>;
          implemented?: Array<{ uid: string; "CodeChunk.xid": string }>;
        }
      | undefined;
  });
  if (!stmt) return { links: 0 };

  const verdict = await verifyCoverageLink(dgraph, statementXid);
  const validatedEvidence: EvidenceTier =
    verdict === "execution-verified" ? "execution-verified" : "human-linked";

  const derivedLinks: Array<{ targetUid: string; targetXid: string; kind: TraceLinkKind; evidence: EvidenceTier }> = [
    ...(stmt.validated ?? []).map((target) => ({
      targetUid: target.uid,
      targetXid: target["TestChunk.xid"],
      kind: "validated_by" as const,
      evidence: validatedEvidence,
    })),
    ...(stmt.implemented ?? []).map((target) => ({
      targetUid: target.uid,
      targetXid: target["CodeChunk.xid"],
      kind: "implemented_by" as const,
      evidence: "human-linked" as const,
    })),
  ];

  for (const link of derivedLinks) {
    await upsertTraceLink(dgraph, { repo, statementUid: stmt.uid, statementXid, ...link });
  }
  return { links: derivedLinks.length };
}

const EVIDENCE_RANK: Record<EvidenceTier, number> = {
  "execution-verified": 5,
  "generated-provenance": 4,
  "human-linked": 3,
  "coverage-bridged": 2,
  "llm-suggested": 1,
};

export function rankEvidence(tier: EvidenceTier): number {
  return EVIDENCE_RANK[tier];
}

export function highestTier(tiers: EvidenceTier[]): EvidenceTier | undefined {
  return tiers.reduce<EvidenceTier | undefined>(
    (best, tier) => (best === undefined || rankEvidence(tier) > rankEvidence(best) ? tier : best),
    undefined,
  );
}
