/**
 * spec-traceability-graph — graph-as-source-of-truth document view. Turns a
 * Dgraph query of one Spec's ordered Sections + Statements (with their
 * validated_by/implemented_by/decided_by links) into a structured, ordinal-
 * ordered document the UI renders directly — section + statement metadata, what
 * each statement links to, and the document's coverage — with NO Postgres chunk
 * store and NO markdown re-parse. Pure: the I/O wrapper ({@link fetchTraceDocument})
 * runs the query; this function is the deterministic projection of its result.
 */

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
  sections?: Array<{ uid: string; "Section.heading"?: string; "Section.ordinal"?: number; "Section.level"?: number }>;
  stmts?: Array<{
    uid: string;
    "Statement.ordinal"?: number;
    "Statement.text"?: string;
    "Statement.kind"?: string;
    "Statement.testability"?: string;
    "Statement.drifted"?: boolean;
    "Statement.violated"?: boolean;
    sec?: { uid: string };
    vb?: Array<{ uid: string; "TestChunk.file_path"?: string; "TestChunk.test_name"?: string; "TestChunk.start_line"?: number }>;
    ib?: Array<{ uid: string; "CodeChunk.file_path"?: string; "CodeChunk.symbol_name"?: string; "CodeChunk.start_line"?: number }>;
    db?: Array<{ uid: string; "ADR.file_path"?: string; "ADR.number"?: number }>;
  }>;
  acs?: Array<{
    uid: string;
    "AcceptanceCriterion.ordinal"?: number;
    "AcceptanceCriterion.text"?: string;
    vb?: Array<{ uid: string; "TestChunk.file_path"?: string; "TestChunk.test_name"?: string; "TestChunk.start_line"?: number }>;
    ib?: Array<{ uid: string; "CodeChunk.file_path"?: string; "CodeChunk.symbol_name"?: string; "CodeChunk.start_line"?: number }>;
  }>;
}

export interface TraceDocumentResult {
  q?: SpecRow[];
}

import type { DgraphClientPort } from "./deps.js";
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

async function listDocPaths(dql: string, predicate: string, repo: string, dgraph: DgraphClientPort): Promise<string[]> {
  const rows = await withTxn(dgraph, async (txn) => {
    const res = await txn.queryWithVars(dql, { $repo: repo });
    return (res.data?.q ?? []) as Array<Record<string, string | undefined>>;
  });
  return rows.map((r) => r[predicate]).filter((p): p is string => typeof p === "string");
}

/** Lists the spec document paths the graph holds for a repo (source of truth for the Specs tab). */
export function listSpecDocuments(repo: string, dgraph: DgraphClientPort): Promise<string[]> {
  return listDocPaths(LIST_SPECS_DQL, "Spec.file_path", repo, dgraph);
}

/** Lists the ADR document paths the graph holds for a repo (ADRs render byte-exact via recomputeFile). */
export function listAdrDocuments(repo: string, dgraph: DgraphClientPort): Promise<string[]> {
  return listDocPaths(LIST_ADRS_DQL, "ADR.file_path", repo, dgraph);
}

/** Card summary of one ADR for list pages: title + description (from its markdown source; no coverage). */
export interface AdrSummary {
  filePath: string;
  title: string;
  description: string;
}

/** Lists each ADR as a card summary (title/description), parsed from its byte-exact reassembled source. */
export async function listAdrSummaries(repo: string, dgraph: DgraphClientPort): Promise<AdrSummary[]> {
  const paths = await listAdrDocuments(repo, dgraph);
  return Promise.all(
    paths.map(async (filePath) => {
      const source = await recomputeFile(repo, filePath, dgraph);
      const { title, description } = summarizeMarkdown(source ?? "");
      return { filePath, title: title || basename(filePath), description };
    }),
  );
}

const LIST_ALL_SPECS_DQL = `query allSpecs {
  q(func: type(Spec), orderasc: Spec.repo) { Spec.repo Spec.file_path }
}`;

/** Cross-repo: every spec document in the graph as {repo, filePath} — backs the global /specs viewer. */
export async function listAllSpecDocuments(dgraph: DgraphClientPort): Promise<Array<{ repo: string; filePath: string }>> {
  const rows = await withTxn(dgraph, async (txn) => {
    const res = await txn.queryWithVars(LIST_ALL_SPECS_DQL, {});
    return (res.data?.q ?? []) as Array<{ "Spec.repo"?: string; "Spec.file_path"?: string }>;
  });
  return rows
    .filter((r) => typeof r["Spec.repo"] === "string" && typeof r["Spec.file_path"] === "string")
    .map((r) => ({ repo: r["Spec.repo"]!, filePath: r["Spec.file_path"]! }));
}

/** Reads one spec's ordered Section/Statement structure + links + coverage from the graph. */
export async function fetchTraceDocument(repo: string, filePath: string, dgraph: DgraphClientPort): Promise<TraceDocument> {
  const data = await withTxn(dgraph, async (txn) => {
    const res = await txn.queryWithVars(TRACE_DOC_DQL, { $xid: `${repo}|${filePath}` });
    return (res.data ?? {}) as TraceDocumentResult;
  });
  return assembleTraceDocument(data);
}

/** Card summary of one spec for list pages: title + description + coverage, keyed by path. */
export interface SpecSummary {
  filePath: string;
  title: string;
  description: string;
  coverage: TraceCoverage;
}

/**
 * Lists each spec in the repo as a card summary (title/description/coverage).
 * Reuses the per-document assembler — currently one query per spec (N+1); a
 * single per-spec aggregation DQL is a future optimization.
 */
export async function listSpecSummaries(repo: string, dgraph: DgraphClientPort): Promise<SpecSummary[]> {
  const paths = await listSpecDocuments(repo, dgraph);
  return Promise.all(
    paths.map(async (filePath) => {
      const doc = await fetchTraceDocument(repo, filePath, dgraph);
      return { filePath, title: doc.title, description: doc.description, coverage: doc.coverage };
    }),
  );
}

function basename(path: string): string {
  return path.split("/").pop() ?? path;
}

type LinkableRow = Pick<NonNullable<SpecRow["stmts"]>[number], "uid" | "vb" | "ib" | "db">;

function linksOf(stmt: LinkableRow): TraceLinkRef[] {
  const links: TraceLinkRef[] = [];
  for (const t of stmt.vb ?? []) {
    const path = t["TestChunk.file_path"];
    links.push({ kind: "test", label: path ? basename(path) : t.uid, path, line: t["TestChunk.start_line"], detail: t["TestChunk.test_name"] });
  }
  for (const c of stmt.ib ?? []) {
    const path = c["CodeChunk.file_path"];
    links.push({ kind: "code", label: c["CodeChunk.symbol_name"] ?? (path ? basename(path) : c.uid), path, line: c["CodeChunk.start_line"] });
  }
  for (const a of stmt.db ?? []) {
    const path = a["ADR.file_path"];
    const num = a["ADR.number"];
    links.push({ kind: "adr", label: num !== undefined ? `ADR-${num}` : path ? basename(path) : a.uid, path });
  }
  return links;
}

function stateOf(testability: string | undefined, hasValidatingLink: boolean): StatementState {
  if (testability === "untestable") return "narrative";
  return hasValidatingLink ? "tested" : "untested";
}

/** The list-page card summary: first section heading as title, first statement as description. */
function cardSummary(filePath: string, sections: TraceSection[], statements: TraceStatement[]): { title: string; description: string } {
  return { title: sections[0]?.heading ?? basename(filePath), description: statements[0]?.text ?? "" };
}

/** Document title: the spec's H1 (Spec.title) when present, else the card's section/basename fallback. */
function docTitle(specTitle: string | undefined, cardTitle: string): string {
  return specTitle?.trim() || cardTitle;
}

export function assembleTraceDocument(data: TraceDocumentResult): TraceDocument {
  const spec = data.q?.[0];
  if (!spec) return { filePath: "", ...cardSummary("", [], []), sections: [], statements: [], coverage: { testable: 0, covered: 0, untestable: 0, ratio: 0 } };

  const sections: TraceSection[] = (spec.sections ?? [])
    .map((s) => ({ uid: s.uid, heading: s["Section.heading"] ?? "(section)", ordinal: s["Section.ordinal"] ?? 0, level: s["Section.level"] }))
    .sort((left, right) => left.ordinal - right.ordinal);

  const fromStatements: TraceStatement[] = (spec.stmts ?? []).map((st) => {
    const links = linksOf(st);
    return {
      uid: st.uid,
      ordinal: st["Statement.ordinal"] ?? 0,
      text: (st["Statement.text"] ?? "").trim(),
      kind: st["Statement.kind"],
      testability: st["Statement.testability"],
      sectionUid: st.sec?.uid,
      state: stateOf(st["Statement.testability"], links.some((l) => l.kind === "test")),
      drifted: st["Statement.drifted"],
      violated: st["Statement.violated"],
      links,
    };
  });

  const fromAcceptanceCriteria: TraceStatement[] = (spec.acs ?? []).map((ac) => {
    const links = linksOf(ac);
    return {
      uid: ac.uid,
      ordinal: ac["AcceptanceCriterion.ordinal"] ?? 0,
      text: (ac["AcceptanceCriterion.text"] ?? "").trim(),
      kind: "acceptance-criterion",
      state: stateOf(undefined, links.some((l) => l.kind === "test")),
      links,
    };
  });

  const statements: TraceStatement[] = [...fromStatements, ...fromAcceptanceCriteria].sort(
    (left, right) => left.ordinal - right.ordinal,
  );

  const untestable = statements.filter((s) => s.state === "narrative").length;
  const covered = statements.filter((s) => s.state === "tested").length;
  const testable = statements.length - untestable;

  const card = cardSummary(spec["Spec.file_path"] ?? "", sections, statements);

  return {
    filePath: spec["Spec.file_path"] ?? "",
    title: docTitle(spec["Spec.title"], card.title),
    description: card.description,
    sections,
    statements,
    coverage: { testable, covered, untestable, ratio: testable === 0 ? 0 : covered / testable },
  };
}
