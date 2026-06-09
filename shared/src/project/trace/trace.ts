import type { TracePort } from "./trace-port.js";
import type { TraceDocument } from "../../spec-trace/assemble-trace-document.js";
import type { SpecGraph, SpecRing } from "../../spec-trace/spec-graph.js";

/**
 * project.trace — the spec-traceability graph view for one repo. Reconstructs
 * documents (ordered sections + statements + links + coverage) from the graph
 * rather than the Postgres chunk store; the graph is the source of truth.
 */
export class TraceView {
  constructor(
    private readonly fullName: string,
    private readonly port: TracePort,
  ) {}

  /** The spec document paths the graph holds for this repo. */
  specs(): Promise<string[]> {
    return this.port.listSpecs(this.fullName);
  }

  /** The ADR document paths the graph holds for this repo. */
  adrs(): Promise<string[]> {
    return this.port.listAdrs(this.fullName);
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
