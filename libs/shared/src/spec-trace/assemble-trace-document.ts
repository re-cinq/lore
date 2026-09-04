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

import type { DgraphClientPort } from "./deps.js";
import {
  docStatusPill,
  type DocKind,
  type DocStatusPill,
} from "../spec-status.js";
import { withTxn } from "./dgraph-upsert.js";
import { recomputeFile } from "./recompute-spec-file.js";
import { summarizeMarkdown } from "./summarize-markdown.js";

const TRACE_DOC_DQL = `query traceDoc($xid: string) {
  q(func: eq(Spec.xid, $xid)) {
    uid
    Spec.file_path
    Spec.title
    sections: Spec.sections { uid Section.heading Section.ordinal Section.level }
    stmts: ~Statement.spec {
      uid
      Statement.ordinal Statement.text Statement.kind Statement.testability Statement.drifted Statement.violated
      sec: Statement.section { uid }
      vb: Statement.validated_by { uid TestChunk.file_path TestChunk.test_name TestChunk.start_line }
      ib: Statement.implemented_by { uid CodeChunk.file_path CodeChunk.symbol_name CodeChunk.start_line }
      db: Statement.decided_by { uid ADR.file_path ADR.number }
    }
    acs: ~AcceptanceCriterion.spec {
      uid
      AcceptanceCriterion.ordinal AcceptanceCriterion.text
      vb: AcceptanceCriterion.validated_by { uid TestChunk.file_path TestChunk.test_name TestChunk.start_line }
      ib: AcceptanceCriterion.implemented_by { uid CodeChunk.file_path CodeChunk.symbol_name CodeChunk.start_line }
    }
  }
}`;

const LIST_SPECS_DQL = `query specs($repo: string) {
  q(func: eq(Spec.repo, $repo), orderasc: Spec.file_path) { Spec.file_path }
}`;

const LIST_ADRS_DQL = `query adrs($repo: string) {
  q(func: type(ADR), orderasc: ADR.file_path) @filter(eq(ADR.repo, $repo)) { ADR.file_path }
}`;

async function listDocPaths(
  dql: string,
  predicate: string,
  repo: string,
  dgraph: DgraphClientPort,
): Promise<string[]> {
  const rows = await withTxn(dgraph, async (txn) => {
    const res = await txn.queryWithVars(dql, { $repo: repo });

    return (res.data?.q ?? []) as Array<Record<string, string | undefined>>;
  });

  return rows
    .map((r) => r[predicate])
    .filter((p): p is string => typeof p === "string");
}

/** Lists the spec document paths the graph holds for a repo (source of truth for the Specs tab). */
export function listSpecDocuments(
  repo: string,
  dgraph: DgraphClientPort,
): Promise<string[]> {
  return listDocPaths(LIST_SPECS_DQL, "Spec.file_path", repo, dgraph);
}

/** Lists the ADR document paths the graph holds for a repo (ADRs render byte-exact via recomputeFile). */
export function listAdrDocuments(
  repo: string,
  dgraph: DgraphClientPort,
): Promise<string[]> {
  return listDocPaths(LIST_ADRS_DQL, "ADR.file_path", repo, dgraph);
}

/** Card summary of one ADR for list pages: title + description + status (from its markdown source; no coverage). */
export interface AdrSummary {
  filePath: string;
  title: string;
  description: string;
  status: DocStatusPill | null;
}

/** Lists each ADR as a card summary, parsed from its byte-exact reassembled source. */
export async function listAdrSummaries(
  repo: string,
  dgraph: DgraphClientPort,
): Promise<AdrSummary[]> {
  const paths = await listAdrDocuments(repo, dgraph);

  return Promise.all(
    paths.map(async (filePath) => {
      const source = await recomputeFile(repo, filePath, dgraph);
      const { title, description } = summarizeMarkdown(source ?? "");

      return {
        filePath,
        title: title || basename(filePath),
        description,
        // Free: the source is already reassembled here for title/description.
        status: source ? docStatusPill(source, "adr") : null,
      };
    }),
  );
}

const LIST_ALL_SPECS_DQL = `query allSpecs {
  q(func: type(Spec), orderasc: Spec.repo) { Spec.repo Spec.file_path }
}`;

const LIST_ALL_ADRS_DQL = `query allAdrs {
  q(func: type(ADR), orderasc: ADR.repo) { ADR.repo ADR.file_path }
}`;

async function listAllDocPaths(
  dql: string,
  repoPredicate: string,
  pathPredicate: string,
  dgraph: DgraphClientPort,
): Promise<Array<{ repo: string; filePath: string }>> {
  const rows = await withTxn(dgraph, async (txn) => {
    const res = await txn.queryWithVars(dql, {});

    return (res.data?.q ?? []) as Array<Record<string, string | undefined>>;
  });

  return rows
    .filter(
      (r) =>
        typeof r[repoPredicate] === "string" &&
        typeof r[pathPredicate] === "string",
    )
    .map((r) => ({ repo: r[repoPredicate]!, filePath: r[pathPredicate]! }));
}

/** A global-viewer list entry: the document's identity plus its lifecycle pill. */
export interface GlobalDocEntry {
  repo: string;
  filePath: string;
  status: DocStatusPill | null;
}

/** Attach status pill from Block layer; parallelized (~194ms for 113 specs). */
async function withStatuses(
  docs: Array<{ repo: string; filePath: string }>,
  kind: DocKind,
  dgraph: DgraphClientPort,
): Promise<GlobalDocEntry[]> {
  return Promise.all(
    docs.map(async (doc) => {
      if (kind === "spec" && basename(doc.filePath) !== "spec.md") {
        return { ...doc, status: null };
      }
      const source = await recomputeFile(doc.repo, doc.filePath, dgraph);

      return { ...doc, status: source ? docStatusPill(source, kind) : null };
    }),
  );
}

/** Cross-repo: every spec document in the graph with its status — backs the global /specs viewer. */
export async function listAllSpecDocuments(
  dgraph: DgraphClientPort,
): Promise<GlobalDocEntry[]> {
  return withStatuses(
    await listAllDocPaths(
      LIST_ALL_SPECS_DQL,
      "Spec.repo",
      "Spec.file_path",
      dgraph,
    ),
    "spec",
    dgraph,
  );
}

/** Cross-repo: every ADR document in the graph with its status — backs the global /adrs viewer. */
export async function listAllAdrDocuments(
  dgraph: DgraphClientPort,
): Promise<GlobalDocEntry[]> {
  return withStatuses(
    await listAllDocPaths(
      LIST_ALL_ADRS_DQL,
      "ADR.repo",
      "ADR.file_path",
      dgraph,
    ),
    "adr",
    dgraph,
  );
}

/** Reads one spec's ordered Section/Statement structure + links + coverage from the graph. */
export async function fetchTraceDocument(
  repo: string,
  filePath: string,
  dgraph: DgraphClientPort,
): Promise<TraceDocument> {
  const graph = await withTxn(dgraph, async (txn) => {
    const res = await txn.queryWithVars(TRACE_DOC_DQL, {
      $xid: `${repo}|${filePath}`,
    });

    return (res.data ?? {}) as TraceDocumentResult;
  });

  return assembleTraceDocument(graph);
}

/** Card summary of one spec for list pages: title + description + coverage, keyed by path. */
export interface SpecSummary {
  filePath: string;
  title: string;
  description: string;
  coverage: TraceCoverage;
  status: DocStatusPill | null;
}

/** List spec card summaries (N+1 queries; future: single aggregation DQL). */
export async function listSpecSummaries(
  repo: string,
  dgraph: DgraphClientPort,
): Promise<SpecSummary[]> {
  const paths = await listSpecDocuments(repo, dgraph);

  return Promise.all(
    paths.map(async (filePath) => {
      const doc = await fetchTraceDocument(repo, filePath, dgraph);

      return {
        filePath,
        title: doc.title,
        description: doc.description,
        coverage: doc.coverage,
        status: await specStatusOf(repo, filePath, dgraph),
      };
    }),
  );
}

/** Only spec.md carries a `| Status |` row; other spec paths have no pill. */
async function specStatusOf(
  repo: string,
  filePath: string,
  dgraph: DgraphClientPort,
): Promise<DocStatusPill | null> {
  if (basename(filePath) !== "spec.md") {
    return null;
  }
  const source = await recomputeFile(repo, filePath, dgraph);

  return source ? docStatusPill(source, "spec") : null;
}

function basename(path: string): string {
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
