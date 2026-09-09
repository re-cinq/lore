/** Reified TraceLink edge-evidence model; direct edges remain authoritative, evidence monotonic-up (Phase 4). */

import type { DgraphClientPort } from "../../outbound/spec-trace/deps.js";
import {
  upsertByXid,
  withTxn,
} from "../../outbound/spec-trace/dgraph-upsert.js";
import { verifyCoverageLink } from "./verify-coverage.js";
import { firstOf } from "./uid-refs.js";

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

export async function projectTraceLinks(
  dgraph: DgraphClientPort,
  repo: string,
  statementXid: string,
): Promise<{ links: number }> {
  const stmt = await readStatementEdges(dgraph, statementXid);

  if (!stmt) {
    return { links: 0 };
  }

  const derivedLinks = await deriveLinks(dgraph, statementXid, stmt);

  for (const link of derivedLinks) {
    await upsertTraceLink(dgraph, {
      repo,
      statementUid: stmt.uid,
      statementXid,
      ...link,
    });
  }

  return { links: derivedLinks.length };
}

interface StatementEdges {
  uid: string;
  validated?: Array<{ uid: string; "TestChunk.xid": string }>;
  implemented?: Array<{ uid: string; "CodeChunk.xid": string }>;
}

/** The statement's outgoing evidence edges, or undefined when the statement itself is gone. */
async function readStatementEdges(
  dgraph: DgraphClientPort,
  statementXid: string,
): Promise<StatementEdges | undefined> {
  return await withTxn(dgraph, async (txn) => {
    const res = await txn.queryWithVars(
      `query q($sx: string){ stmt(func: eq(Statement.xid, $sx)){
        uid
        validated: Statement.validated_by { uid TestChunk.xid }
        implemented: Statement.implemented_by { uid CodeChunk.xid }
      } }`,
      { $sx: statementXid },
    );

    return firstOf(res.data.stmt) as StatementEdges | undefined;
  });
}

interface DerivedLink {
  targetUid: string;
  targetXid: string;
  kind: TraceLinkKind;
  evidence: EvidenceTier;
}

/** A validated_by edge is EXECUTION-VERIFIED only when a run actually covered the statement; a human-written link that no test exercised stays human-linked, so the two never read as the same strength of claim. */
async function deriveLinks(
  dgraph: DgraphClientPort,
  statementXid: string,
  stmt: StatementEdges,
): Promise<DerivedLink[]> {
  const verdict = await verifyCoverageLink(dgraph, statementXid);
  const validatedEvidence: EvidenceTier =
    verdict === "execution-verified" ? "execution-verified" : "human-linked";

  return [
    ...validatedLinks(stmt, validatedEvidence),
    ...implementedLinks(stmt),
  ];
}

function validatedLinks(
  stmt: StatementEdges,
  evidence: EvidenceTier,
): DerivedLink[] {
  return (stmt.validated ?? []).map((target) => ({
    targetUid: target.uid,
    targetXid: target["TestChunk.xid"],
    kind: "validated_by",
    evidence,
  }));
}

/** An implemented_by edge is always human-linked — nothing executes it. */
function implementedLinks(stmt: StatementEdges): DerivedLink[] {
  return (stmt.implemented ?? []).map((target) => ({
    targetUid: target.uid,
    targetXid: target["CodeChunk.xid"],
    kind: "implemented_by",
    evidence: "human-linked",
  }));
}

/** Upsert TraceLink with deterministic xid; evidence only ever raises tier, never lowers. */
export async function upsertTraceLink(
  dgraph: DgraphClientPort,
  args: UpsertTraceLinkArgs,
): Promise<string> {
  const xid = `${args.repo}|${tailOf(args.statementXid, args.repo)}|${tailOf(args.targetXid, args.repo)}|${args.kind}`;
  const evidence = await raisedEvidence(dgraph, xid, args.evidence);
  const traceLinkUid = await upsertByXid(dgraph, "TraceLink", xid, {
    "TraceLink.repo": args.repo,
    "TraceLink.statement": { uid: args.statementUid },
    "TraceLink.target": { uid: args.targetUid },
    "TraceLink.kind": args.kind,
    "TraceLink.evidence": evidence,
  });

  await attachTraceLink(dgraph, args.statementUid, traceLinkUid);

  return traceLinkUid;
}

/** Tail = the xid with the leading `${repo}|` dropped (only the first segment). */
function tailOf(xid: string, repo: string): string {
  return xid.startsWith(`${repo}|`) ? xid.slice(repo.length + 1) : xid;
}

/** The tier this link should end up at. A link only ever climbs: an inline `([validated by …])` claim that has since been proven by an actual test run must not be demoted back to a claim by the next projection that re-reads the markdown. */
async function raisedEvidence(
  dgraph: DgraphClientPort,
  xid: string,
  incoming: EvidenceTier,
): Promise<EvidenceTier> {
  const existing = await withTxn(dgraph, async (txn) => {
    const res = await txn.queryWithVars(
      `query q($x: string){ tl(func: eq(TraceLink.xid, $x)){ TraceLink.evidence } }`,
      { $x: xid },
    );

    return firstOf(res.data.tl)?.["TraceLink.evidence"] as
      EvidenceTier | undefined;
  });

  return existing ? (highestTier([existing, incoming]) ?? incoming) : incoming;
}

export function highestTier(tiers: EvidenceTier[]): EvidenceTier | undefined {
  return tiers.reduce<EvidenceTier | undefined>(
    (best, tier) =>
      best === undefined || rankEvidence(tier) > rankEvidence(best)
        ? tier
        : best,
    undefined,
  );
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

/** Points the statement back at the reified link, so the edge is reachable from both ends. */
async function attachTraceLink(
  dgraph: DgraphClientPort,
  statementUid: string,
  traceLinkUid: string,
): Promise<void> {
  await withTxn(dgraph, (txn) =>
    txn.mutate({
      setJson: {
        uid: statementUid,
        "Statement.trace_links": [{ uid: traceLinkUid }],
      },
      commitNow: true,
    }),
  );
}
