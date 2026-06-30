import type { PgPool } from "../../memory-store.js";
import type { ChunksPort, ChunkInsert } from "./chunks-port.js";

/**
 * Schema names are string-interpolated into the table name, so they are an
 * injection surface. Only `[a-z][a-z0-9_]+` names — the same gate the reindex
 * job applies upstream — are allowed near the interpolation.
 */
const SCHEMA_RE = /^[a-z][a-z0-9_]+$/;

function enforceSchema(schema: string): void {
  if (!SCHEMA_RE.test(schema)) {
    throw new Error(`Invalid schema name: ${JSON.stringify(schema)}`);
  }
}

/**
 * Postgres-backed {@link ChunksPort}. SQL is lifted byte-for-byte from the
 * Floor reindex / context-core-builder jobs. Every `${schema}` query validates
 * the schema name first; the `org_shared.chunks` reads use a fixed table name.
 */
export class PgChunks implements ChunksPort {
  constructor(private readonly pool: PgPool) {}

  async schemaExists(schema: string): Promise<boolean> {
    const { rows } = await this.pool.query(
      `SELECT schema_name FROM information_schema.schemata WHERE schema_name = $1`,
      [schema],
    );
    return rows.length > 0;
  }

  async countChunks(schema: string, repo: string): Promise<number> {
    enforceSchema(schema);
    const { rows } = await this.pool.query(
      `SELECT count(*)::text as c FROM ${schema}.chunks WHERE repo = $1`,
      [repo],
    );
    return Number(rows[0]?.c || 0);
  }

  async deleteChunksForFile(schema: string, filePath: string, repo: string): Promise<void> {
    enforceSchema(schema);
    await this.pool.query(
      `DELETE FROM ${schema}.chunks WHERE file_path = $1 AND repo = $2`,
      [filePath, repo],
    );
  }

  async insertChunk(schema: string, chunk: ChunkInsert): Promise<string | null> {
    enforceSchema(schema);
    const { rows } = await this.pool.query(
      `INSERT INTO ${schema}.chunks (content, content_type, team, repo, file_path, metadata)
       VALUES ($1, $2, $3, $4, $5, $6)
       RETURNING id`,
      [
        chunk.content,
        chunk.contentType,
        chunk.team,
        chunk.repo,
        chunk.filePath,
        JSON.stringify(chunk.metadata),
      ],
    );
    return rows[0]?.id ?? null;
  }

  async setEmbedding(schema: string, chunkId: string, embedding: string): Promise<void> {
    enforceSchema(schema);
    await this.pool.query(
      `UPDATE ${schema}.chunks SET embedding = $1::vector WHERE id = $2`,
      [embedding, chunkId],
    );
  }

  async distinctTeams(): Promise<string[]> {
    const { rows } = await this.pool.query(
      `SELECT DISTINCT team FROM org_shared.chunks WHERE team IS NOT NULL`,
    );
    return rows.map((row) => row.team as string);
  }

  async countChunksByTeam(team: string): Promise<number> {
    const { rows } = await this.pool.query(
      `SELECT COUNT(*) AS count FROM org_shared.chunks WHERE team = $1`,
      [team],
    );
    return parseInt(rows[0]?.count || "0", 10);
  }
}
