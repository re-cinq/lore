import { enforceTrue } from "../lib/enforce.js";
/** Phase 5 deterministic (no LLM) vector candidate suggestion: for an un-linked Statement, ANN-search `CodeChunk`/`TestChunk` embeddings scoped to its own repo, excluding already-linked targets. */

import type { DgraphClientPort } from "./deps.js";
import { withTxn } from "./dgraph-upsert.js";

/** Extracts the repo from a spec-trace xid — the leading segment of `repo|file_path|ordinal`. */
function repoFromXid(xid: string): string {
  return xid.split("|")[0];
}

/** Normalizes a read-back embedding (array of numbers or `"[...]"` literal) to a `"[...]"` string. */
function toVecLiteral(embedding: unknown): string | undefined {
  if (Array.isArray(embedding)) {
    return "[" + embedding.join(",") + "]";
  }

  if (typeof embedding === "string") {
    return embedding;
  }

  return undefined;
}

/** `similar_to` can't pre-filter by repo, so other repos' chunks can starve same-repo candidates out of the global top-k — over-fetch to widen the net before filtering. */
const ANN_OVERFETCH = 10;

/** ANN over one node type's embedding predicate, over-fetched then filtered to same-`repo` nodes; `suggestCandidates` calls it once per CodeChunk/TestChunk and merges. */
async function nearestByVector(
  dgraph: DgraphClientPort,
  embeddingPredicate: string,
  xidPredicate: string,
  vecLiteral: string,
  k: number,
  repo: string,
): Promise<string[]> {
  const repoPredicate = `${embeddingPredicate.split(".")[0]}.repo`;

  return withTxn(dgraph, async (txn) => {
    const res = await txn.queryWithVars(
      `query q($vec: string, $repo: string){ near(func: similar_to(${embeddingPredicate}, ${k * ANN_OVERFETCH}, $vec)) @filter(eq(${repoPredicate}, $repo)){ ${xidPredicate} } }`,
      { $vec: vecLiteral, $repo: repo },
    );
    const rows =
      (res.data as { near?: Array<Record<string, string>> }).near ?? [];

    return rows.map((row) => row[xidPredicate]);
  });
}

/** Reads the Statement's embedding (normalized to an ANN literal) plus the xids it's already linked to, so suggestions can exclude them. */
async function readStatementContext(
  dgraph: DgraphClientPort,
  statementXid: string,
): Promise<{ vecLiteral: string | undefined; linkedXids: Set<string> }> {
  return withTxn(dgraph, async (txn) => {
    const res = await txn.queryWithVars(
      `query q($sx: string){ stmt(func: eq(Statement.xid, $sx)){ Statement.embedding implemented: Statement.implemented_by { CodeChunk.xid } validated: Statement.validated_by { TestChunk.xid } } }`,
      { $sx: statementXid },
    );
    const stmt = (
      res.data as {
        stmt?: Array<{
          "Statement.embedding"?: unknown;
          implemented?: Array<{ "CodeChunk.xid"?: string }>;
          validated?: Array<{ "TestChunk.xid"?: string }>;
        }>;
      }
    ).stmt?.[0];
    const linkedXids = new Set<string>(
      [
        ...(stmt?.implemented ?? []).map((node) => node["CodeChunk.xid"]),
        ...(stmt?.validated ?? []).map((node) => node["TestChunk.xid"]),
      ].filter((xid): xid is string => xid !== undefined),
    );

    return {
      vecLiteral: toVecLiteral(stmt?.["Statement.embedding"]),
      linkedXids,
    };
  });
}

/** AcceptanceCriterion xids carry an `|ac|` segment (`repo|path|ac|N`) that Statement xids (`repo|path|N`) never do. */
const AC_XID_TAIL = /\|ac\|\d+$/;

export async function suggestCandidates(
  dgraph: DgraphClientPort,
  statementXid: string,
  k: number,
): Promise<Array<{ xid: string; kind: "code" | "test" }>> {
  enforceTrue(
    Number.isInteger(k),
    Error,
    `suggestCandidates: k must be an integer, got ${k}`,
  );
  // Suggestions are Statement-only; an AcceptanceCriterion xid would otherwise silently resolve to an empty result.
  enforceTrue(
    !AC_XID_TAIL.test(statementXid),
    Error,
    `suggestCandidates: ${statementXid} is an AcceptanceCriterion xid — suggestions target Statements only`,
  );

  const { vecLiteral, linkedXids } = await readStatementContext(
    dgraph,
    statementXid,
  );

  if (vecLiteral === undefined) {
    return [];
  }

  const repo = repoFromXid(statementXid);
  const [codeXids, testXids] = await Promise.all([
    nearestByVector(
      dgraph,
      "CodeChunk.embedding",
      "CodeChunk.xid",
      vecLiteral,
      k,
      repo,
    ),
    nearestByVector(
      dgraph,
      "TestChunk.embedding",
      "TestChunk.xid",
      vecLiteral,
      k,
      repo,
    ),
  ]);

  const nearestUnlinked = (xids: string[]) =>
    xids.filter((xid) => !linkedXids.has(xid)).slice(0, k);

  return [
    ...nearestUnlinked(codeXids).map((xid) => ({ xid, kind: "code" as const })),
    ...nearestUnlinked(testXids).map((xid) => ({ xid, kind: "test" as const })),
  ];
}
