/**
 * impact-statement-delta — the doc-side coupling direction: what a PR did to a
 * spec's own statements, and what claims to validate the ones it disturbed.
 *
 * The line-based lookups root on a changed production file, so a PR that edits
 * `specs/**\/spec.md` couples to nothing at all — which is why a spec rewrite
 * reported "No spec impact detected" (#1072, #1076, #1081) while changing the
 * very statements the graph is built from.
 *
 * `Statement` carries no line position, so this diffs by CONTENT IDENTITY:
 * `Statement.text_hash` against the hashes of the head file's own segments. That
 * makes it immune to line drift and independent of any graph baseline — it works
 * on a repo that has never been stamped.
 *
 * Deliberate conflation: a statement whose hash is gone from the file is
 * reported as `changed`, not split into "modified" vs "deleted". Without stable
 * per-statement identity across an edit the two are indistinguishable, and the
 * consequence is the same either way — whatever validated the old text is now
 * pointed at something that moved.
 */

import { createHash } from "node:crypto";
import { segmentStatements } from "../spec-segment.js";
import { isAcceptanceCriteriaHeading } from "./project-spec-file.js";
import type { DgraphClientPort } from "./deps.js";
import { withTxn } from "./dgraph-upsert.js";
import type { ImpactStatement } from "./impact-statement.js";

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
  /** Present in the file, unknown to the graph: newly written, nothing validates it yet. */
  added: number;
}

/** Hex sha256 — must stay identical to the projector's, or every statement reads as changed. */
function sha256(text: string): string {
  return createHash("sha256").update(text).digest("hex");
}

/**
 * Diffs a spec's head content against the statements the graph holds for it.
 *
 * Mirrors the projector's own filter: acceptance-criteria segments become
 * `AcceptanceCriterion` nodes, not `Statement` nodes, so counting them here
 * would invent additions that never existed.
 */
export function diffStatements(
  content: string,
  graphStatements: GraphStatementRef[],
): StatementDelta {
  const headHashes = new Set(
    segmentStatements(content)
      .filter(
        (segment) => !isAcceptanceCriteriaHeading(segment.enclosingHeading),
      )
      .map((segment) => sha256(segment.text)),
  );
  const knownHashes = new Set(graphStatements.map((s) => s.textHash));

  return {
    changed: graphStatements.filter((s) => !headHashes.has(s.textHash)),
    added: [...headHashes].filter((h) => !knownHashes.has(h)).length,
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

/**
 * Statements this PR disturbed in a changed spec, as impact findings.
 *
 * Only `changed` statements become findings: they are the ones something already
 * claims to validate, so they are the ones a reviewer can act on. The `added`
 * count rides on the report separately — a brand-new statement has no links yet
 * by definition, and listing each one as a finding would bury the actionable set.
 */
export async function specFileImpact(
  dgraph: DgraphClientPort,
  repo: string,
  specPath: string,
  content: string,
): Promise<{
  statements: Array<ImpactStatement & { xid: string }>;
  added: number;
}> {
  const known = await readSpecStatements(dgraph, repo, specPath);
  const delta = diffStatements(content, known);

  return {
    added: delta.added,
    statements: delta.changed.map((stmt) => ({
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
    })),
  };
}
