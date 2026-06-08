import type { PgPool } from "../../memory-store.js";
import type {
  KnowledgePort,
  AssembledContext,
  GraphEdge,
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

  async queryLiveGraph(repo: string, term?: string): Promise<GraphEdge[]> {
    const sql = term
      ? `SELECT s.name as entity, e.relation_type as relation, t.name as related_entity
           FROM memory.edges e
           JOIN memory.entities s ON s.id = e.source_id
           JOIN memory.entities t ON t.id = e.target_id
          WHERE LOWER(s.name) = LOWER($1) AND e.valid_to IS NULL
            AND ($2::text IS NULL OR s.repo = $2 OR s.repo IS NULL)
          ORDER BY e.valid_from DESC LIMIT 50`
      : `SELECT s.name as entity, e.relation_type as relation, t.name as related_entity
           FROM memory.edges e
           JOIN memory.entities s ON s.id = e.source_id
           JOIN memory.entities t ON t.id = e.target_id
          WHERE e.valid_to IS NULL
            AND ($1::text IS NULL OR s.repo = $1 OR s.repo IS NULL)
          ORDER BY e.created_at DESC LIMIT 50`;
    const params = term ? [term, repo] : [repo];
    const { rows } = await this.pool.query(sql, params);
    return rows.map((r) => ({ entity: r.entity, relation: r.relation, relatedEntity: r.related_entity }));
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
