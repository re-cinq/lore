/** The shape every impact lookup returns, plus rules for merging the same statement reached by more than one route; `evidence` records which route found it. */

/** How a statement was reached, strongest first — see {@link EVIDENCE_RANK}. */
export type Evidence =
  "statement-edit" | "coverage" | "test-link" | "file-link";

/** Merge precedence, strongest first: statement-edit (observed diff) > coverage (executed lines) > test-link (confirmed span) > file-link (unchecked). */
const EVIDENCE_RANK: Record<Evidence, number> = {
  "statement-edit": 3,
  coverage: 2,
  "test-link": 1,
  "file-link": 0,
};

/** What the diff did to a statement's own text (doc-side lookup only); "changed" deliberately covers both edited and deleted, since the diff can't tell them apart. */
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
  /** For a rewritten statement, the "after" text that replaced it; absent when deleted outright or nothing close enough was found. */
  rewrittenAs?: string;
  /** Whether this PR also touches a test validating the statement — the drift signal: statement moved, its tests didn't. */
  testsTouched?: boolean;
}

interface GraphSpecRef {
  "Spec.file_path"?: string;
  "Spec.title"?: string;
}

export interface GraphStatement {
  "Statement.xid"?: string;
  "Statement.text"?: string;
  // Statement.spec / Statement.section are single-cardinality `uid` edges, so Dgraph returns objects, not arrays.
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

/** Unions statements from every coupling path by xid, merging test selectors and keeping the strongest evidence — one finding per statement. */
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
    addMissingTests(existing.tests, stmt.tests);
  }

  return [...byXid.values()].map(({ xid: _xid, ...rest }) => rest);
}

function addMissingTests(
  existingTests: ImpactStatement["tests"],
  incomingTests: ImpactStatement["tests"],
): void {
  for (const test of incomingTests) {
    const alreadyListed = existingTests.some(
      (t) => t.file === test.file && t.name === test.name,
    );

    if (!alreadyListed) {
      existingTests.push(test);
    }
  }
}
