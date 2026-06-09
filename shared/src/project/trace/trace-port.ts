import type { TraceDocument } from "../../spec-trace/assemble-trace-document.js";
import type { SpecGraph, SpecRing } from "../../spec-trace/spec-graph.js";

/**
 * The seam between the Project facade and the spec-traceability graph
 * (Dgraph). The graph is the source of truth: documents are reconstructed from
 * ordered nodes, not the Postgres chunk store.
 */
export interface TracePort {
  /** Spec document paths the graph holds for the repo. */
  listSpecs(repo: string): Promise<string[]>;
  /** ADR document paths the graph holds for the repo. */
  listAdrs(repo: string): Promise<string[]>;
  /** One spec's ordered Section/Statement structure + links + coverage. */
  document(repo: string, filePath: string): Promise<TraceDocument>;
  /** Byte-exact source of any ingested document, reassembled from its Block nodes; null if never projected. */
  source(repo: string, filePath: string): Promise<string | null>;
  /** The repo's spec force-graph (Specs + linked Statements + test/code/ADR nodes). */
  graph(repo: string): Promise<SpecGraph>;
  /** One spec's two-ring structure (sections + per-statement coverage) for graph expansion. */
  ring(repo: string, filePath: string): Promise<SpecRing>;
}
