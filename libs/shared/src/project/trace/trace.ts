import type { TracePort } from "./trace-port.js";
import type {
  TraceDocument,
  SpecSummary,
  AdrSummary,
} from "../../spec-trace/assemble-trace-document.js";
import type { SpecGraph, SpecRing } from "../../spec-trace/spec-graph.js";

/** Spec-traceability graph view; graph is source of truth, not Postgres chunk store. */
export class TraceView {
  constructor(
    private readonly fullName: string,
    private readonly port: TracePort,
  ) {}

  /** The spec document paths the graph holds for this repo. */
  specs(): Promise<string[]> {
    return this.port.listSpecs(this.fullName);
  }

  /** Card summaries (title/description/coverage) for this repo's specs. */
  specSummaries(): Promise<SpecSummary[]> {
    return this.port.specSummaries(this.fullName);
  }

  /** The ADR document paths the graph holds for this repo. */
  adrs(): Promise<string[]> {
    return this.port.listAdrs(this.fullName);
  }

  /** Card summaries (title/description) for this repo's ADRs. */
  adrSummaries(): Promise<AdrSummary[]> {
    return this.port.adrSummaries(this.fullName);
  }

  /** One spec's ordered Section/Statement structure + links + coverage. */
  document(filePath: string): Promise<TraceDocument> {
    return this.port.document(this.fullName, filePath);
  }

  /** Byte-exact source of any ingested document (specs, ADRs), reassembled from the graph; null if absent. */
  source(filePath: string): Promise<string | null> {
    return this.port.source(this.fullName, filePath);
  }

  /** The repo's spec force-graph for the Graph tab. */
  graph(): Promise<SpecGraph> {
    return this.port.graph(this.fullName);
  }

  /** One spec's two-ring structure (sections + per-statement coverage) for graph expansion. */
  ring(filePath: string): Promise<SpecRing> {
    return this.port.ring(this.fullName, filePath);
  }
}
