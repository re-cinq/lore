import type { DgraphClientPort } from "../../memory-store.js";
import {
  fetchTraceDocument,
  listSpecDocuments,
  listAdrDocuments,
  listSpecSummaries,
  listAdrSummaries,
  type TraceDocument,
  type SpecSummary,
  type AdrSummary,
} from "../../spec-trace/assemble-trace-document.js";
import { recomputeFile } from "../../spec-trace/recompute-spec-file.js";
import { fetchSpecGraph, fetchSpecRing, type SpecGraph, type SpecRing } from "../../spec-trace/spec-graph.js";
import type { TracePort } from "./trace-port.js";

/** TracePort over the live spec-trace Dgraph — the same client the ingest path projects into. */
export class DgraphTrace implements TracePort {
  constructor(private readonly dgraph: DgraphClientPort) {}

  listSpecs(repo: string): Promise<string[]> {
    return listSpecDocuments(repo, this.dgraph);
  }

  specSummaries(repo: string): Promise<SpecSummary[]> {
    return listSpecSummaries(repo, this.dgraph);
  }

  listAdrs(repo: string): Promise<string[]> {
    return listAdrDocuments(repo, this.dgraph);
  }

  adrSummaries(repo: string): Promise<AdrSummary[]> {
    return listAdrSummaries(repo, this.dgraph);
  }

  document(repo: string, filePath: string): Promise<TraceDocument> {
    return fetchTraceDocument(repo, filePath, this.dgraph);
  }

  source(repo: string, filePath: string): Promise<string | null> {
    return recomputeFile(repo, filePath, this.dgraph);
  }

  graph(repo: string): Promise<SpecGraph> {
    return fetchSpecGraph(repo, this.dgraph);
  }

  ring(repo: string, filePath: string): Promise<SpecRing> {
    return fetchSpecRing(repo, filePath, this.dgraph);
  }
}
