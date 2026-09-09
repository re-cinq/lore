/** Knowledge port for specs/ADRs/graph reads. */

import type { LiveGraphResult } from "./live-graph.js";

export interface AssembledContext {
  text: string;
}

export interface DocRef {
  path: string;
  title: string;
}

/** Single-sourced queryTrace stub response. */
export const TRACE_NOT_DEPLOYED_MESSAGE =
  "Trace queries are not yet available: the spec-traceability graph projection is not deployed in this build.";

export interface KnowledgePort {
  assembleContext(repo: string, query: string): Promise<AssembledContext>;
  queryLiveGraph(repo: string, term?: string): Promise<LiveGraphResult[]>;
  queryTrace(repo: string, query: string): Promise<string>;
  listSpecs(repo: string): Promise<DocRef[]>;
  listAdrs(repo: string): Promise<DocRef[]>;
}
