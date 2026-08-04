import type { LiveGraphResult } from "./live-graph.js";
import type {
  KnowledgePort,
  AssembledContext,
  DocRef,
} from "./knowledge-port.js";

/** A seeded chunk row the doc listings read (`{schema}.chunks` in Pg). */
export interface SeedDoc {
  repo: string;
  path: string;
  contentType: "spec" | "adr" | string;
}

/**
 * In-memory {@link KnowledgePort}: the behavioral spec of the Pg adapter's own
 * logic (the doc listings). assembleContext and queryTrace are canned — the Pg
 * adapter only delegates to the heavy retrieval modules there, so the double
 * returns seeded text rather than re-specifying retrieval.
 */
export class InMemoryKnowledge implements KnowledgePort {
  private readonly docs: SeedDoc[];
  private readonly graph: LiveGraphResult[];
  private readonly contextText: string;

  constructor(
    opts: {
      docs?: SeedDoc[];
      graph?: LiveGraphResult[];
      contextText?: string;
    } = {},
  ) {
    this.docs = opts.docs ?? [];
    this.graph = opts.graph ?? [];
    this.contextText = opts.contextText ?? "";
  }

  async assembleContext(
    _repo: string,
    _query: string,
  ): Promise<AssembledContext> {
    return { text: this.contextText };
  }

  async queryLiveGraph(
    _repo: string,
    term?: string,
  ): Promise<LiveGraphResult[]> {
    if (term === undefined) {
      return [...this.graph];
    }

    // Mirrors the entity branch: case-insensitive EXACT name match.
    return this.graph.filter(
      (r) => r.entity.toLowerCase() === term.toLowerCase(),
    );
  }

  queryTrace(_repo: string, _query: string): Promise<string> {
    // Byte-identical to the Pg stub — callers branch on this sentence.
    return Promise.resolve(
      "Trace queries are not yet available: the spec-traceability graph projection is not deployed in this build.",
    );
  }

  listSpecs(repo: string): Promise<DocRef[]> {
    return this.listDocs(repo, "spec");
  }

  listAdrs(repo: string): Promise<DocRef[]> {
    return this.listDocs(repo, "adr");
  }

  private async listDocs(
    repo: string,
    contentType: "spec" | "adr",
  ): Promise<DocRef[]> {
    // SELECT DISTINCT file_path … WHERE content_type/repo … LIKE '%.md' ORDER BY file_path
    const paths = this.docs
      .filter(
        (d) =>
          d.contentType === contentType &&
          d.repo === repo &&
          d.path.endsWith(".md"),
      )
      .map((d) => d.path);

    return [...new Set(paths)].sort().map((path) => ({ path, title: path }));
  }
}
