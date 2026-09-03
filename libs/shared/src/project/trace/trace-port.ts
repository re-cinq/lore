import type {
  TraceDocument,
  SpecSummary,
  AdrSummary,
} from "../../spec-trace/assemble-trace-document.js";
import type { SpecGraph, SpecRing } from "../../spec-trace/spec-graph.js";

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
}
