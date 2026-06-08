import type { PgPool } from "../../memory-store.js";
import { queryLiveGraph, type LiveGraphResult } from "./live-graph.js";
import type {
  KnowledgePort,
  AssembledContext,
  DocRef,
} from "./knowledge-port.js";

const SCHEMA_RE = /^[a-z_][a-z0-9_]*$/;

/**
 * KnowledgePort over Postgres. queryLiveGraph is relocated from
 * mcp-server/src/graph.ts; listSpecs/listAdrs read the repo's team-schema chunks
 * (schema resolution relocated from web-ui/src/lib/db.ts getRepoSchema).
 * assembleContext is the heavy template module — wired once it is relocated;
 * queryTrace mirrors the current spec-traceability stub.
 */
export class PgKnowledge implements KnowledgePort {
  constructor(private readonly pool: PgPool) {}

  assembleContext(): Promise<AssembledContext> {
    throw new Error("knowledge.assembleContext needs the relocated context-assembly module (pending)");
  }

  queryLiveGraph(repo: string, term?: string): Promise<LiveGraphResult[]> {
    return queryLiveGraph(this.pool, term, undefined, repo, false);
  }

  queryTrace(): Promise<string> {
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

  private async listDocs(repo: string, contentType: "spec" | "adr"): Promise<DocRef[]> {
    const schema = await this.resolveSchema(repo);
    const { rows } = await this.pool.query(
      `SELECT DISTINCT file_path FROM ${schema}.chunks
        WHERE content_type = $1 AND repo = $2 AND file_path LIKE '%.md'
        ORDER BY file_path`,
      [contentType, repo],
    );
    return rows.map((r) => ({ path: r.file_path, title: r.file_path }));
  }

  private async resolveSchema(repo: string): Promise<string> {
    const { rows } = await this.pool.query("SELECT team FROM lore.repos WHERE full_name = $1", [repo]);
    const team = (rows[0]?.team as string | null) ?? "";
    return SCHEMA_RE.test(team) ? team : "org_shared";
  }
}
