import type { PgPool } from "../../memory-store.js";
import { resolveChunkSchemaForRepo } from "../chunks/chunk-schema.js";
import { queryLiveGraph, type LiveGraphResult } from "./live-graph.js";
import { assembleContext as runAssembleContext } from "./context-assembly.js";
import {
  TRACE_NOT_DEPLOYED_MESSAGE,
  type KnowledgePort,
  type AssembledContext,
  type DocRef,
} from "./knowledge-port.js";

/** KnowledgePort over Postgres with team-schema chunk resolution. */
export class PgKnowledge implements KnowledgePort {
  constructor(private readonly pool: PgPool) {}

  async assembleContext(
    repo: string,
    query: string,
  ): Promise<AssembledContext> {
    const result = await runAssembleContext(this.pool, query, { repo });

    return { text: result.text };
  }

  queryLiveGraph(repo: string, term?: string): Promise<LiveGraphResult[]> {
    return queryLiveGraph(this.pool, { entity: term, repo });
  }

  queryTrace(): Promise<string> {
    return Promise.resolve(TRACE_NOT_DEPLOYED_MESSAGE);
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
    const schema = await resolveChunkSchemaForRepo(this.pool, repo);
    const { rows } = await this.pool.query<{ file_path: string }>(
      `SELECT DISTINCT file_path FROM ${schema}.chunks
        WHERE content_type = $1 AND repo = $2 AND file_path LIKE '%.md'
        ORDER BY file_path`,
      [contentType, repo],
    );

    return rows.map((r) => ({ path: r.file_path, title: r.file_path }));
  }
}
