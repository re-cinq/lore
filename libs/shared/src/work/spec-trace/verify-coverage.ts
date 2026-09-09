/** spec-traceability-graph Phase 3 — read-only coverage-first verdict for a statement: "untested" (no VALIDATED_BY), "execution-verified" (a validating test covers a File the statement IMPLEMENTS), else "link-unproven"; never mutates the graph. */

import type { DgraphClientPort } from "../../outbound/spec-trace/deps.js";
import { withTxn } from "../../outbound/spec-trace/dgraph-upsert.js";
import { firstOf } from "./uid-refs.js";

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
  const statement = await readVerification(dgraph, statementXid);
  const validatingTests = statement.validated_by ?? [];

  if (validatingTests.length === 0) {
    return "untested";
  }

  if (implementsCoveredFile(statement, coveredFilePaths(validatingTests))) {
    return "execution-verified";
  }

  return "link-unproven";
}

/** The statement's tests and implementation, one hop each. Reads both sides in one query because the verdict is about their OVERLAP — whether a test that claims the statement actually executes the code implementing it. */
async function readVerification(
  dgraph: DgraphClientPort,
  statementXid: string,
): Promise<StatementVerification> {
  return withTxn(dgraph, async (txn) => {
    const res = await txn.queryWithVars(
      `query q($sx: string){
        stmt(func: eq(Statement.xid, $sx)){
          validated_by: Statement.validated_by { uid TestChunk.coverage { Coverage.covers { File.path } } }
          implemented: Statement.implemented_by { CodeChunk.file_path }
        }
      }`,
      { $sx: statementXid },
    );

    return (firstOf(res.data.stmt) ?? {}) as StatementVerification;
  });
}

/** The set of File paths the validating tests actually execute, one hop through each test's Coverage. */
function coveredFilePaths(
  validatingTests: NonNullable<StatementVerification["validated_by"]>,
): Set<string> {
  return new Set(
    validatingTests
      .flatMap((test) => test["TestChunk.coverage"]?.["Coverage.covers"] ?? [])
      .flatMap((file) => (file["File.path"] ? [file["File.path"]] : [])),
  );
}

/** True when any implementing CodeChunk sits in a file the validating tests executed — the overlap that upgrades a link to execution-verified. */
function implementsCoveredFile(
  statement: StatementVerification,
  coveredFiles: Set<string>,
): boolean {
  return (statement.implemented ?? []).some(
    (chunk) =>
      chunk["CodeChunk.file_path"] !== undefined &&
      coveredFiles.has(chunk["CodeChunk.file_path"]),
  );
}
