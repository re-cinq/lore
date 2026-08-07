/**
 * impact-statement — the shape every impact lookup returns, and the rules for
 * merging the same statement reached by more than one route.
 *
 * Each lookup couples a PR diff to spec Statements through a different edge, and
 * the routes differ in how much they prove. `evidence` records which one found
 * it so a reader can weigh a coverage-backed finding against a hand-typed link,
 * instead of meeting them as one undifferentiated list.
 */

/** How a statement was reached, strongest first — see {@link EVIDENCE_RANK}. */
export type Evidence =
  "statement-edit" | "coverage" | "test-link" | "file-link";

/**
 * Merge precedence. `statement-edit` outranks everything because the diff
 * changed the statement's own text — that is observed, not inferred. `coverage`
 * next: a test run actually executed those lines. `test-link` is an author's
 * link confirmed to point at a real test span; `file-link` is the same claim
 * with no line span left to check.
 */
const EVIDENCE_RANK: Record<Evidence, number> = {
  "statement-edit": 3,
  coverage: 2,
  "test-link": 1,
  "file-link": 0,
};

/**
 * What the diff did to a statement's own text. Only set by the doc-side lookup.
 * "changed" covers edited AND deleted deliberately: without stable identity
 * across an edit the two are indistinguishable, and naming it "modified" would
 * claim a precision the diff cannot support.
 */
export type ChangeKind = "added" | "changed";

/** A spec statement coupled to the diff, with the tests that cover it (selectors). */
export interface ImpactStatement {
  specPath: string;
  specTitle: string;
  section?: string;
  statementText: string;
  statementAnchor: string;
  tests: { file: string; name: string; line: number }[];
  changedFile: string;
  evidence: Evidence;
  changeKind?: ChangeKind;
  /**
   * For a rewritten statement, the text that replaced it — the "after" side of
   * the diff. Absent when the statement was deleted outright, or when nothing in
   * the head file was close enough to be its replacement.
   */
  rewrittenAs?: string;
  /**
   * Whether this PR also touches at least one of the tests that validate the
   * statement. The single most useful bit in a finding: a statement whose code
   * or text moved while its tests did not is the drift worth looking at.
   */
  testsTouched?: boolean;
}

interface GraphSpecRef {
  "Spec.file_path"?: string;
  "Spec.title"?: string;
}

export interface GraphStatement {
  "Statement.xid"?: string;
  "Statement.text"?: string;
  // Statement.spec / Statement.section are single-cardinality `uid` edges, so
  // Dgraph returns them as objects, not arrays.
  spec?: GraphSpecRef;
  section?: { "Section.heading"?: string };
}

/** The statement projection every impact query shares, so the shapes cannot drift apart. */
export const STATEMENT_PROJECTION = `Statement.xid
      Statement.text
      spec: Statement.spec { Spec.file_path Spec.title }
      section: Statement.section { Section.heading }`;

/** Builds an ImpactStatement from a graph Statement, carrying its xid for dedup. */
export function toImpactStatement(
  stmt: GraphStatement,
  changedFile: string,
  tests: ImpactStatement["tests"],
  evidence: Evidence,
): ImpactStatement & { xid: string } {
  const specPath = stmt.spec?.["Spec.file_path"] ?? "";

  return {
    xid:
      stmt["Statement.xid"] ?? `${specPath}::${stmt["Statement.text"] ?? ""}`,
    specPath,
    specTitle: stmt.spec?.["Spec.title"] ?? "",
    section: stmt.section?.["Section.heading"],
    statementText: stmt["Statement.text"] ?? "",
    statementAnchor: specPath,
    tests,
    changedFile,
    evidence,
  };
}

/**
 * Unions statements from every coupling path by xid, merging their test
 * selectors and keeping the strongest evidence. A statement found by two routes
 * is one finding, reported at the confidence of its best route.
 */
export function mergeStatements(
  raw: Array<ImpactStatement & { xid: string }>,
): ImpactStatement[] {
  const byXid = new Map<string, ImpactStatement & { xid: string }>();

  for (const stmt of raw) {
    const existing = byXid.get(stmt.xid);

    if (!existing) {
      byXid.set(stmt.xid, { ...stmt, tests: [...stmt.tests] });
      continue;
    }

    if (EVIDENCE_RANK[stmt.evidence] > EVIDENCE_RANK[existing.evidence]) {
      existing.evidence = stmt.evidence;
      existing.changedFile = stmt.changedFile;
    }
    existing.changeKind ??= stmt.changeKind;

    for (const test of stmt.tests) {
      if (
        !existing.tests.some(
          (t) => t.file === test.file && t.name === test.name,
        )
      ) {
        existing.tests.push(test);
      }
    }
  }

  return [...byXid.values()].map(({ xid: _xid, ...rest }) => rest);
}
