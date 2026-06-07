/**
 * spec-traceability-graph — Phase 3 coverage-first verification.
 *
 * Read-only derivation of a single statement's coverage verdict. Walks the live
 * graph from the Statement through VALIDATED_BY → HAS_COVERAGE → COVERS to the
 * CodeChunks its tests actually execute, and compares that set with the
 * CodeChunks the statement IMPLEMENTS. When the two sets intersect the
 * statement's link is backed by real execution → "execution-verified".
 *
 * Verdict rule:
 *   - "untested"           — the statement has no VALIDATED_BY edges at all.
 *   - "execution-verified" — a validating test executes (COVERS) a CodeChunk the
 *                            statement IMPLEMENTS (covered ∩ implemented ≠ ∅).
 *   - "link-unproven"      — the statement is validated_by a test, but no test
 *                            covers any chunk it implements.
 * Never mutates the graph.
 *
 * Shares the one-shot `withTxn` idiom with the sibling writers via
 * `./dgraph-upsert`. Talks only to the injected DgraphClientPort.
 */

import type { DgraphClientPort } from "@re-cinq/lore-shared";
import { withTxn } from "./dgraph-upsert.js";

type UidRef = { uid: string };

type StatementVerification = {
  validated_by?: Array<{ uid: string; "TestChunk.coverage"?: { "Coverage.covers"?: UidRef[] } }>;
  implemented?: UidRef[];
};

export async function verifyCoverageLink(
  dgraph: DgraphClientPort,
  statementXid: string,
): Promise<"execution-verified" | "link-unproven" | "untested"> {
  const statement = await withTxn(dgraph, async (txn) => {
    const res = await txn.queryWithVars(
      `query q($sx: string){
        stmt(func: eq(Statement.xid, $sx)){
          validated_by: Statement.validated_by { uid TestChunk.coverage { Coverage.covers { uid } } }
          implemented: Statement.implemented_by { uid }
        }
      }`,
      { $sx: statementXid },
    );
    return (res.data?.stmt?.[0] ?? {}) as StatementVerification;
  });

  const validatingTests = statement.validated_by ?? [];
  if (validatingTests.length === 0) return "untested";

  const coveredUids = new Set<string>();
  for (const test of validatingTests) {
    for (const chunk of test["TestChunk.coverage"]?.["Coverage.covers"] ?? []) {
      coveredUids.add(chunk.uid);
    }
  }

  const implementsCovered = (statement.implemented ?? []).some((chunk) => coveredUids.has(chunk.uid));
  if (implementsCovered) return "execution-verified";

  return "link-unproven";
}
