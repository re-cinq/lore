/**
 * spec-traceability-graph — Phase 3 coverage-first verification.
 *
 * Read-only derivation of a single statement's coverage verdict. Walks the live
 * graph from the Statement through VALIDATED_BY → HAS_COVERAGE → COVERS to the
 * Files its tests actually execute, and compares those file paths with the
 * file paths of the CodeChunks the statement IMPLEMENTS. When a covered file is
 * one the statement implements, its link is backed by real execution →
 * "execution-verified". (Coverage aggregates to File nodes, so the match is by
 * file path, not node identity.)
 *
 * Verdict rule:
 *   - "untested"           — the statement has no VALIDATED_BY edges at all.
 *   - "execution-verified" — a validating test covers a File the statement
 *                            IMPLEMENTS code in (covered ∩ implemented files ≠ ∅).
 *   - "link-unproven"      — the statement is validated_by a test, but no test
 *                            covers any file it implements.
 * Never mutates the graph.
 *
 * Shares the one-shot `withTxn` idiom with the sibling writers via
 * `./dgraph-upsert`. Talks only to the injected DgraphClientPort.
 */

import type { DgraphClientPort } from "./deps.js";
import { withTxn } from "./dgraph-upsert.js";

type StatementVerification = {
  validated_by?: Array<{ uid: string; "TestChunk.coverage"?: { "Coverage.covers"?: Array<{ "File.path"?: string }> } }>;
  implemented?: Array<{ "CodeChunk.file_path"?: string }>;
};

export async function verifyCoverageLink(
  dgraph: DgraphClientPort,
  statementXid: string,
): Promise<"execution-verified" | "link-unproven" | "untested"> {
  const statement = await withTxn(dgraph, async (txn) => {
    const res = await txn.queryWithVars(
      `query q($sx: string){
        stmt(func: eq(Statement.xid, $sx)){
          validated_by: Statement.validated_by { uid TestChunk.coverage { Coverage.covers { File.path } } }
          implemented: Statement.implemented_by { CodeChunk.file_path }
        }
      }`,
      { $sx: statementXid },
    );
    return (res.data?.stmt?.[0] ?? {}) as StatementVerification;
  });

  const validatingTests = statement.validated_by ?? [];
  if (validatingTests.length === 0) return "untested";

  const coveredFiles = new Set<string>();
  for (const test of validatingTests) {
    for (const file of test["TestChunk.coverage"]?.["Coverage.covers"] ?? []) {
      if (file["File.path"]) coveredFiles.add(file["File.path"]);
    }
  }

  const implementsCovered = (statement.implemented ?? []).some(
    (chunk) => chunk["CodeChunk.file_path"] !== undefined && coveredFiles.has(chunk["CodeChunk.file_path"]),
  );
  if (implementsCovered) return "execution-verified";

  return "link-unproven";
}
