import type { TraceDocument } from "../../../domain/spec-trace/assemble-trace-document.js";
import type {
  SpecSummary,
  AdrSummary,
} from "../../spec-trace/trace-document-listing.js";
import type { SpecGraph, SpecRing } from "../../spec-trace/spec-graph.js";
import type {
  CoveringTest,
  CoverageTarget,
} from "../../spec-trace/tests-covering.js";
import type { FailureHit } from "../../spec-trace/failure-reads.js";
import type {
  CallDirection,
  CodeCaller,
} from "../../spec-trace/code-callers.js";
import type { GraphContextBlock } from "../../spec-trace/graph-context.js";

export type {
  TraceDocument,
  SpecSummary,
  AdrSummary,
  SpecGraph,
  SpecRing,
  CoveringTest,
  CoverageTarget,
  FailureHit,
  CallDirection,
  CodeCaller,
  GraphContextBlock,
};

/** Seam between Project facade and spec-traceability graph (Dgraph, source of truth). */
export interface TracePort {
  /** Spec document paths the graph holds for the repo. */
  listSpecs(repo: string): Promise<string[]>;
  /** Card summaries (title/description/coverage) for the repo's specs. */
  specSummaries(repo: string): Promise<SpecSummary[]>;
  /** ADR document paths the graph holds for the repo. */
  listAdrs(repo: string): Promise<string[]>;
  /** Card summaries (title/description) for the repo's ADRs. */
  adrSummaries(repo: string): Promise<AdrSummary[]>;
  /** One spec's ordered Section/Statement structure + links + coverage. */
  document(repo: string, filePath: string): Promise<TraceDocument>;
  /** Byte-exact source of any ingested document, reassembled from its Block nodes; null if never projected. */
  source(repo: string, filePath: string): Promise<string | null>;
  /** The repo's spec force-graph (Specs + linked Statements + test/code/ADR nodes). */
  graph(repo: string): Promise<SpecGraph>;
  /** One spec's two-ring structure (sections + per-statement coverage) for graph expansion. */
  ring(repo: string, filePath: string): Promise<SpecRing>;
  /** Test files exercising a source span — that branch's overlay when `branch` is given, else main. */
  testsCovering(
    repo: string,
    target: CoverageTarget,
    branch?: string,
  ): Promise<CoveringTest[]>;
  /** Failures recorded against a source file, newest first, each with the sha that ended it when one did. */
  failuresTouching(repo: string, path: string): Promise<FailureHit[]>;
  /** One hop of the call graph: the definitions that call `symbol`, or that it calls. */
  callers(
    repo: string,
    symbol: string,
    direction: CallDirection,
  ): Promise<CodeCaller[]>;
  /** The repo's coupled spec statements, ranked by signal and capped at `limit`. */
  graphContext(
    repo: string,
    opts?: { limit?: number },
  ): Promise<GraphContextBlock>;
}
