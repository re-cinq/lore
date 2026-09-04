/** Graph-as-source-of-truth spec document view (deterministic projection, no markdown re-parse). */

export type StatementState = "tested" | "untested" | "narrative";
export type TraceLinkKind = "test" | "code" | "adr";

export interface TraceLinkRef {
  kind: TraceLinkKind;
  label: string;
  path?: string;
  line?: number;
  detail?: string;
}

export interface TraceSection {
  uid: string;
  heading: string;
  ordinal: number;
  level?: number;
}

export interface TraceStatement {
  uid: string;
  ordinal: number;
  text: string;
  kind?: string;
  testability?: string;
  sectionUid?: string;
  state: StatementState;
  drifted?: boolean;
  violated?: boolean;
  links: TraceLinkRef[];
}

export interface TraceCoverage {
  testable: number;
  covered: number;
  untestable: number;
  ratio: number;
}

export interface TraceDocument {
  filePath: string;
  title: string;
  description: string;
  sections: TraceSection[];
  statements: TraceStatement[];
  coverage: TraceCoverage;
}

interface SpecRow {
  uid: string;
  "Spec.file_path"?: string;
  "Spec.title"?: string;
  sections?: Array<{
    uid: string;
    "Section.heading"?: string;
    "Section.ordinal"?: number;
    "Section.level"?: number;
  }>;
  stmts?: Array<{
    uid: string;
    "Statement.ordinal"?: number;
    "Statement.text"?: string;
    "Statement.kind"?: string;
    "Statement.testability"?: string;
    "Statement.drifted"?: boolean;
    "Statement.violated"?: boolean;
    sec?: { uid: string };
    vb?: Array<{
      uid: string;
      "TestChunk.file_path"?: string;
      "TestChunk.test_name"?: string;
      "TestChunk.start_line"?: number;
    }>;
    ib?: Array<{
      uid: string;
      "CodeChunk.file_path"?: string;
      "CodeChunk.symbol_name"?: string;
      "CodeChunk.start_line"?: number;
    }>;
    db?: Array<{
      uid: string;
      "ADR.file_path"?: string;
      "ADR.number"?: number;
    }>;
  }>;
  acs?: Array<{
    uid: string;
    "AcceptanceCriterion.ordinal"?: number;
    "AcceptanceCriterion.text"?: string;
    vb?: Array<{
      uid: string;
      "TestChunk.file_path"?: string;
      "TestChunk.test_name"?: string;
      "TestChunk.start_line"?: number;
    }>;
    ib?: Array<{
      uid: string;
      "CodeChunk.file_path"?: string;
      "CodeChunk.symbol_name"?: string;
      "CodeChunk.start_line"?: number;
    }>;
  }>;
}

export interface TraceDocumentResult {
  q?: SpecRow[];
}

export {
  listSpecDocuments,
  listAdrDocuments,
  listAdrSummaries,
  listAllSpecDocuments,
  listAllAdrDocuments,
  fetchTraceDocument,
  listSpecSummaries,
  type AdrSummary,
  type GlobalDocEntry,
  type SpecSummary,
} from "./trace-document-listing.js";

export function basename(path: string): string {
  return path.split("/").pop() ?? path;
}

type LinkableRow = Pick<
  NonNullable<SpecRow["stmts"]>[number],
  "uid" | "vb" | "ib" | "db"
>;

function testLinks(vb: LinkableRow["vb"]): TraceLinkRef[] {
  return (vb ?? []).map((t) => {
    const path = t["TestChunk.file_path"];

    return {
      kind: "test",
      label: path ? basename(path) : t.uid,
      path,
      line: t["TestChunk.start_line"],
      detail: t["TestChunk.test_name"],
    };
  });
}

function codeLinks(ib: LinkableRow["ib"]): TraceLinkRef[] {
  return (ib ?? []).map((c) => {
    const path = c["CodeChunk.file_path"];

    return {
      kind: "code",
      label: c["CodeChunk.symbol_name"] ?? (path ? basename(path) : c.uid),
      path,
      line: c["CodeChunk.start_line"],
    };
  });
}

function adrLinks(db: LinkableRow["db"]): TraceLinkRef[] {
  return (db ?? []).map((a) => {
    const path = a["ADR.file_path"];
    const num = a["ADR.number"];
    const pathLabel = path ? basename(path) : a.uid;

    return {
      kind: "adr",
      label: num !== undefined ? `ADR-${num}` : pathLabel,
      path,
    };
  });
}

function linksOf(stmt: LinkableRow): TraceLinkRef[] {
  return [...testLinks(stmt.vb), ...codeLinks(stmt.ib), ...adrLinks(stmt.db)];
}

function stateOf(
  testability: string | undefined,
  hasValidatingLink: boolean,
): StatementState {
  if (testability === "untestable") {
    return "narrative";
  }

  return hasValidatingLink ? "tested" : "untested";
}

/** The list-page card summary: first section heading as title, first statement as description. */
function cardSummary(
  filePath: string,
  sections: TraceSection[],
  statements: TraceStatement[],
): { title: string; description: string } {
  return {
    title: sections[0]?.heading ?? basename(filePath),
    description: statements[0]?.text ?? "",
  };
}

/** Document title: the spec's H1 (Spec.title) when present, else the card's section/basename fallback. */
function docTitle(specTitle: string | undefined, cardTitle: string): string {
  return specTitle?.trim() || cardTitle;
}

function emptyTraceDocument(): TraceDocument {
  return {
    filePath: "",
    ...cardSummary("", [], []),
    sections: [],
    statements: [],
    coverage: { testable: 0, covered: 0, untestable: 0, ratio: 0 },
  };
}

function sectionsOf(spec: SpecRow): TraceSection[] {
  return (spec.sections ?? [])
    .map((s) => ({
      uid: s.uid,
      heading: s["Section.heading"] ?? "(section)",
      ordinal: s["Section.ordinal"] ?? 0,
      level: s["Section.level"],
    }))
    .sort((left, right) => left.ordinal - right.ordinal);
}

function statementsFromStatements(
  stmts: NonNullable<SpecRow["stmts"]>,
): TraceStatement[] {
  return stmts.map((st) => {
    const links = linksOf(st);

    return {
      uid: st.uid,
      ordinal: st["Statement.ordinal"] ?? 0,
      text: (st["Statement.text"] ?? "").trim(),
      kind: st["Statement.kind"],
      testability: st["Statement.testability"],
      sectionUid: st.sec?.uid,
      state: stateOf(
        st["Statement.testability"],
        links.some((l) => l.kind === "test"),
      ),
      drifted: st["Statement.drifted"],
      violated: st["Statement.violated"],
      links,
    };
  });
}

function statementsFromAcceptanceCriteria(
  acs: NonNullable<SpecRow["acs"]>,
): TraceStatement[] {
  return acs.map((ac) => {
    const links = linksOf(ac);

    return {
      uid: ac.uid,
      ordinal: ac["AcceptanceCriterion.ordinal"] ?? 0,
      text: (ac["AcceptanceCriterion.text"] ?? "").trim(),
      kind: "acceptance-criterion",
      state: stateOf(
        undefined,
        links.some((l) => l.kind === "test"),
      ),
      links,
    };
  });
}

function coverageOf(statements: TraceStatement[]): TraceCoverage {
  const untestable = statements.filter((s) => s.state === "narrative").length;
  const covered = statements.filter((s) => s.state === "tested").length;
  const testable = statements.length - untestable;

  return {
    testable,
    covered,
    untestable,
    ratio: testable === 0 ? 0 : covered / testable,
  };
}

function buildTraceDocumentFromSpec(spec: SpecRow): TraceDocument {
  const filePath = spec["Spec.file_path"] ?? "";
  const sections = sectionsOf(spec);
  const statements: TraceStatement[] = [
    ...statementsFromStatements(spec.stmts ?? []),
    ...statementsFromAcceptanceCriteria(spec.acs ?? []),
  ].sort((left, right) => left.ordinal - right.ordinal);

  const card = cardSummary(filePath, sections, statements);

  return {
    filePath,
    title: docTitle(spec["Spec.title"], card.title),
    description: card.description,
    sections,
    statements,
    coverage: coverageOf(statements),
  };
}

export function assembleTraceDocument(
  graph: TraceDocumentResult,
): TraceDocument {
  const spec = graph.q?.[0];

  return spec ? buildTraceDocumentFromSpec(spec) : emptyTraceDocument();
}
