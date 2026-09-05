/** Graph-backed document listing — spec/ADR path enumeration, card summaries, and status pills for the list/global viewers. */

import type { DgraphClientPort } from "./deps.js";
import {
  docStatusPill,
  type DocKind,
  type DocStatusPill,
} from "../spec-status.js";
import { withTxn } from "./dgraph-upsert.js";
import { recomputeFile } from "./recompute-spec-file.js";
import { summarizeMarkdown } from "./summarize-markdown.js";
import {
  assembleTraceDocument,
  basename,
  type TraceCoverage,
  type TraceDocument,
  type TraceDocumentResult,
} from "./assemble-trace-document.js";

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

    return (res.data.q ?? []) as Array<Record<string, string | undefined>>;
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

    return (res.data.q ?? []) as Array<Record<string, string | undefined>>;
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

    return res.data as TraceDocumentResult;
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
