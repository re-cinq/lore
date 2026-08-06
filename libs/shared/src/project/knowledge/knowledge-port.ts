/**
 * Knowledge port — specs/ADRs/graph reads. The adapter wraps the existing
 * assembleContext + queryLiveGraph (mcp-server) and the spec-traceability
 * queryTrace (stub today). No retrieval logic is reimplemented here.
 */

import type { LiveGraphResult } from "./live-graph.js";

export interface AssembledContext {
  text: string;
}

export interface DocRef {
  path: string;
  title: string;
}

/**
 * The queryTrace stub response, single-sourced so the Pg adapter and the
 * in-memory double cannot drift — callers branch on this sentence.
 */
export const TRACE_NOT_DEPLOYED_MESSAGE =
  "Trace queries are not yet available: the spec-traceability graph projection is not deployed in this build.";

export interface KnowledgePort {
  assembleContext(repo: string, query: string): Promise<AssembledContext>;
  queryLiveGraph(repo: string, term?: string): Promise<LiveGraphResult[]>;
  queryTrace(repo: string, query: string): Promise<string>;
  listSpecs(repo: string): Promise<DocRef[]>;
  listAdrs(repo: string): Promise<DocRef[]>;
}
