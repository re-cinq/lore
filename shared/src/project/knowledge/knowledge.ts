import type {
  KnowledgePort,
  AssembledContext,
  GraphEdge,
  DocRef,
} from "./knowledge-port.js";

/**
 * project.knowledge — repo-bound reads over specs, ADRs, the live knowledge
 * graph, and the spec-traceability graph. Everything delegates to the port.
 */
export class KnowledgeView {
  constructor(
    private readonly repo: string,
    private readonly knowledge: KnowledgePort,
  ) {}

  assembleContext(query: string): Promise<AssembledContext> {
    return this.knowledge.assembleContext(this.repo, query);
  }

  queryLiveGraph(term?: string): Promise<GraphEdge[]> {
    return this.knowledge.queryLiveGraph(this.repo, term);
  }

  queryTrace(query: string): Promise<string> {
    return this.knowledge.queryTrace(this.repo, query);
  }

  listSpecs(): Promise<DocRef[]> {
    return this.knowledge.listSpecs(this.repo);
  }

  listAdrs(): Promise<DocRef[]> {
    return this.knowledge.listAdrs(this.repo);
  }
}
