/**
 * Knowledge port — specs/ADRs/graph reads. The adapter wraps the existing
 * assembleContext + queryLiveGraph (mcp-server) and the spec-traceability
 * queryTrace (stub today). No retrieval logic is reimplemented here.
 */

export interface AssembledContext {
  text: string;
}

export interface GraphEdge {
  entity: string;
  relation: string;
  relatedEntity: string;
}

export interface DocRef {
  path: string;
  title: string;
}

export interface KnowledgePort {
  assembleContext(repo: string, query: string): Promise<AssembledContext>;
  queryLiveGraph(repo: string, term?: string): Promise<GraphEdge[]>;
  queryTrace(repo: string, query: string): Promise<string>;
  listSpecs(repo: string): Promise<DocRef[]>;
  listAdrs(repo: string): Promise<DocRef[]>;
}
