/** spec-traceability-graph Phase 3 — read-only coverage-first verdict for a statement: "untested" (no VALIDATED_BY), "execution-verified" (a validating test covers a File the statement IMPLEMENTS), else "link-unproven"; never mutates the graph. */

import type { DgraphClientPort } from "./deps.js";
import { withTxn } from "./dgraph-upsert.js";

type StatementVerification = {
  validated_by?: Array<{
    uid: string;
    "TestChunk.coverage"?: {
      "Coverage.covers"?: Array<{ "File.path"?: string }>;
    };
  }>;
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

  if (validatingTests.length === 0) {
    return "untested";
  }

  const coveredFiles = new Set(
    validatingTests
      .flatMap((test) => test["TestChunk.coverage"]?.["Coverage.covers"] ?? [])
      .flatMap((file) => (file["File.path"] ? [file["File.path"]] : [])),
  );

  const implementsCovered = (statement.implemented ?? []).some(
    (chunk) =>
      chunk["CodeChunk.file_path"] !== undefined &&
      coveredFiles.has(chunk["CodeChunk.file_path"]),
  );

  if (implementsCovered) {
    return "execution-verified";
  }

  return "link-unproven";
}
