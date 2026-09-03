/** Doc-side coupling direction; diffs by content identity (text_hash) independent of line position or baseline. */

import { createHash } from "node:crypto";
import { segmentStatements } from "../spec-segment.js";
import { isAcceptanceCriteriaHeading } from "./project-spec-file.js";
import type { DgraphClientPort } from "./deps.js";
import { withTxn } from "./dgraph-upsert.js";
import type { ImpactStatement } from "./impact-statement.js";
import { pairRewrites } from "./statement-pairing.js";

/** A statement as the graph holds it, with whatever claims to validate it. */
export interface GraphStatementRef {
  xid: string;
  textHash: string;
  text: string;
  specTitle: string;
  section?: string;
  tests: { file: string; name: string; line: number }[];
}

export interface StatementDelta {
  /** Known to the graph, its text no longer present in the file: edited or deleted. */
  changed: GraphStatementRef[];
  /** Present in the file, unknown to the graph; carried as text to enable diffing. */
  addedTexts: string[];
}

/** Hex sha256 — must stay identical to the projector's, or every statement reads as changed. */
function sha256(text: string): string {
  return createHash("sha256").update(text).digest("hex");
}

/** Diffs spec's head content against graph statements; filters ACs like the projector. */
export function diffStatements(
  content: string,
  graphStatements: GraphStatementRef[],
): StatementDelta {
  const headStatements = segmentStatements(content).filter(
    (segment) => !isAcceptanceCriteriaHeading(segment.enclosingHeading),
  );
  const headByHash = new Map(
    headStatements.map((segment) => [sha256(segment.text), segment.text]),
  );
  const knownHashes = new Set(graphStatements.map((s) => s.textHash));

  return {
    changed: graphStatements.filter((s) => !headByHash.has(s.textHash)),
    addedTexts: [...headByHash]
      .filter(([hash]) => !knownHashes.has(hash))
      .map(([, text]) => text),
  };
}

const SPEC_STATEMENTS_QUERY = `query q($repo: string, $fp: string) {
  specs(func: eq(Spec.file_path, $fp)) @filter(eq(Spec.repo, $repo)) {
    Spec.title
    stmts: ~Statement.spec {
      Statement.xid
      Statement.text
      Statement.text_hash
      section: Statement.section { Section.heading }
      tests: Statement.validated_by {
        TestChunk.file_path
        TestChunk.test_name
        TestChunk.start_line
      }
    }
  }
}`;

interface GraphSpecStatements {
  "Spec.title"?: string;
  stmts?: {
    "Statement.xid"?: string;
    "Statement.text"?: string;
    "Statement.text_hash"?: string;
    section?: { "Section.heading"?: string };
    tests?: {
      "TestChunk.file_path"?: string;
      "TestChunk.test_name"?: string;
      "TestChunk.start_line"?: number;
    }[];
  }[];
}

/** Reads a spec's statements as the graph holds them, with their validating tests. */
export async function readSpecStatements(
  dgraph: DgraphClientPort,
  repo: string,
  specPath: string,
): Promise<GraphStatementRef[]> {
  const specs = await withTxn(dgraph, async (txn) => {
    const res = await txn.queryWithVars(SPEC_STATEMENTS_QUERY, {
      $repo: repo,
      $fp: specPath,
    });

    return (res.data?.specs ?? []) as GraphSpecStatements[];
  });

  return specs.flatMap((spec) =>
    (spec.stmts ?? [])
      .filter((stmt) => stmt["Statement.text_hash"])
      .map((stmt) => ({
        xid: stmt["Statement.xid"] ?? "",
        textHash: stmt["Statement.text_hash"] ?? "",
        text: stmt["Statement.text"] ?? "",
        specTitle: spec["Spec.title"] ?? "",
        section: stmt.section?.["Section.heading"],
        tests: (stmt.tests ?? []).map((test) => ({
          file: test["TestChunk.file_path"] ?? "",
          name: test["TestChunk.test_name"] ?? "",
          line: test["TestChunk.start_line"] ?? 0,
        })),
      })),
  );
}

/** Disturbed statements from a changed spec, as impact findings; only changed+validated statements are listed. */
export async function specFileImpact(
  dgraph: DgraphClientPort,
  repo: string,
  specPath: string,
  content: string,
): Promise<{
  statements: Array<ImpactStatement & { xid: string }>;
  added: number;
  changedWithoutTests: number;
}> {
  const known = await readSpecStatements(dgraph, repo, specPath);
  const delta = diffStatements(content, known);
  const validated = delta.changed.filter((stmt) => stmt.tests.length);
  // Recover rewrites to show before/after instead of non-existent text.
  const rewrites = pairRewrites(
    validated.map((stmt) => stmt.text),
    delta.addedTexts,
  );

  return {
    added: delta.addedTexts.length,
    changedWithoutTests: delta.changed.length - validated.length,
    statements: validated.map((stmt) => ({
      xid: stmt.xid,
      specPath,
      specTitle: stmt.specTitle,
      section: stmt.section,
      statementText: stmt.text,
      statementAnchor: specPath,
      tests: stmt.tests,
      changedFile: specPath,
      evidence: "statement-edit" as const,
      changeKind: "changed" as const,
      rewrittenAs: rewrites.get(stmt.text) ?? undefined,
    })),
  };
}
