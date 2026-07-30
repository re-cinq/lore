import { enforceTrue } from "../lib/enforce.js";
/**
 * spec-traceability-graph — Phase 5 deterministic vector candidate suggestion.
 *
 * For an un-linked Statement, reads its embedding and runs a Dgraph `similar_to`
 * ANN over both `CodeChunk.embedding` and `TestChunk.embedding`, returning the
 * nearest code and test chunks. No LLM.
 *
 * Results are scoped to the Statement's own repo: chunks from other repos are
 * never suggested, even if they carry an identical embedding. Already-linked
 * targets (via `Statement.implemented_by`/`Statement.validated_by`) are excluded —
 * suggestions are for un-linked gaps only.
 *
 * Kernel invariant: a Statement and a chunk carrying the SAME embedding →
 * that chunk is the top candidate for its kind.
 */

import type { DgraphClientPort } from "./deps.js";
import { withTxn } from "./dgraph-upsert.js";

/**
 * Extracts the repo from a spec-trace xid. Every node's xid is
 * `repo|file_path|ordinal` (chunks: `repo|...`), so the leading segment is the repo.
 */
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

/**
 * `similar_to` searches the whole index and cannot pre-filter, so the repo
 * `@filter` runs on the global top-k: other repos' chunks consume slots and can
 * starve same-repo candidates entirely. Over-fetching widens the net before the
 * filter; the caller truncates back to `k`.
 */
const ANN_OVERFETCH = 10;

/**
 * Runs a `similar_to` ANN over one node type's embedding predicate and returns
 * the nearest same-`repo` nodes' xids, nearest-first (over-fetches
 * `k * ANN_OVERFETCH` globally, then filters to `repo` via the derived
 * `<Type>.repo` predicate, e.g. `CodeChunk.embedding` → `CodeChunk.repo`).
 * `embeddingPredicate`/`xidPredicate` are fixed, code-supplied schema names
 * (e.g. `CodeChunk.embedding`/`CodeChunk.xid`), never user input, so inlining
 * the fetch size into the query is safe. Shared per-predicate ANN:
 * `suggestCandidates` calls it once with `CodeChunk.*` and once with
 * `TestChunk.*` and merges the results.
 */
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

/**
 * Reads the Statement's embedding (normalized to a `"[...]"` ANN literal) and the
 * set of xids it is already linked to (`Statement.implemented_by` CodeChunks +
 * `Statement.validated_by` TestChunks) so suggestions can exclude them.
 */
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

/**
 * AcceptanceCriterion xids carry an `|ac|` segment (`repo|path|ac|N`) that
 * Statement xids (`repo|path|N`) never do.
 */
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
  // Suggestions are Statement-only (spec-traceability-graph statement 10):
  // readStatementContext queries Statement.xid, so an AcceptanceCriterion xid
  // would silently resolve to no embedding and an empty result. Fail loud instead.
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
