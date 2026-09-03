import type {
  KnowledgePort,
  AssembledContext,
  DocRef,
} from "./knowledge-port.js";
import type { LiveGraphResult } from "./live-graph.js";

/** Repo-bound reads over specs, ADRs, knowledge graph, and trace. */
export class KnowledgeView {
  constructor(
    private readonly repo: string,
    private readonly knowledge: KnowledgePort,
  ) {}

  assembleContext(query: string): Promise<AssembledContext> {
    return this.knowledge.assembleContext(this.repo, query);
  }

  queryLiveGraph(term?: string): Promise<LiveGraphResult[]> {
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
