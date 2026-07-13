import { enforceTrue } from "@re-cinq/lore-shared/lib/enforce.js";
import type { PgPool } from "../../memory-store.js";
import type {
  ChunksPort,
  ChunkInsert,
  SpecChunkRow,
  CodeSymbolRow,
  SpecChunkWithIngest,
  TestChunkRange,
  SpecChunkWithEmbedding,
  CodeChunkFull,
} from "./chunks-port.js";

/**
 * Schema names are string-interpolated into the table name, so they are an
 * injection surface. Only `[a-z][a-z0-9_]+` names — the same gate the reindex
 * job applies upstream — are allowed near the interpolation.
 */
const SCHEMA_RE = /^[a-z][a-z0-9_]+$/;

function enforceSchema(schema: string): void {
  enforceTrue(
    SCHEMA_RE.test(schema),
    new Error(`Invalid schema name: ${JSON.stringify(schema)}`),
  );
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

  async deleteChunksForFile(
    schema: string,
    filePath: string,
    repo: string,
  ): Promise<void> {
    enforceSchema(schema);
    await this.pool.query(
      `DELETE FROM ${schema}.chunks WHERE file_path = $1 AND repo = $2`,
      [filePath, repo],
    );
  }

  async insertChunk(
    schema: string,
    chunk: ChunkInsert,
  ): Promise<string | null> {
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

  async setEmbedding(
    schema: string,
    chunkId: string,
    embedding: string,
  ): Promise<void> {
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

  async specChunks(repo: string): Promise<SpecChunkRow[]> {
    const { rows } = await this.pool.query(
      `SELECT id, repo, file_path, content
       FROM org_shared.chunks
       WHERE content_type = 'spec' AND repo = $1
       ORDER BY file_path`,
      [repo],
    );
    return rows.map((r) => ({
      id: String(r.id),
      repo: r.repo as string,
      filePath: r.file_path as string,
      content: r.content as string,
    }));
  }

  async codeSymbols(repo: string): Promise<CodeSymbolRow[]> {
    const { rows } = await this.pool.query(
      `SELECT metadata->>'symbol_name' AS symbol_name,
              metadata->>'symbol_type' AS symbol_type,
              file_path
       FROM org_shared.chunks
       WHERE repo = $1
         AND content_type = 'code'
         AND metadata->>'symbol_name' IS NOT NULL`,
      [repo],
    );
    return rows.map((r) => ({
      symbolName: r.symbol_name as string,
      symbolType: (r.symbol_type as string | null) ?? null,
      filePath: r.file_path as string,
    }));
  }

  async hasChunk(
    repo: string,
    contentType: string,
    fileSuffix?: string,
  ): Promise<boolean> {
    const { rows } = await this.pool.query(
      `SELECT id FROM org_shared.chunks
       WHERE repo = $1 AND content_type = $2
         ${fileSuffix ? "AND file_path LIKE $3" : ""}
       LIMIT 1`,
      fileSuffix ? [repo, contentType, `%${fileSuffix}`] : [repo, contentType],
    );
    return rows.length > 0;
  }

  async staleChunkCount(repo: string, olderThanDays: number): Promise<number> {
    const { rows } = await this.pool.query(
      `SELECT COUNT(*) AS count FROM org_shared.chunks
       WHERE repo = $1
         AND ingested_at < NOW() - ($2 || ' days')::interval`,
      [repo, String(olderThanDays)],
    );
    return parseInt(rows[0]?.count || "0", 10);
  }

  /** The schema reindex wrote this repo's chunks to: its team schema when one
   *  exists, else `org_shared` (mirrors the reindex job's resolveSchema). */
  private async resolveSchemaForRepo(repo: string): Promise<string> {
    const { rows } = await this.pool.query(
      "SELECT team FROM lore.repos WHERE full_name = $1",
      [repo],
    );
    const team = rows[0]?.team as string | undefined;
    if (team && SCHEMA_RE.test(team) && (await this.schemaExists(team)))
      return team;
    return "org_shared";
  }

  async specChunksWithIngest(repo: string): Promise<SpecChunkWithIngest[]> {
    const schema = await this.resolveSchemaForRepo(repo);
    const { rows } = await this.pool.query(
      `SELECT repo, file_path, content, ingested_at
       FROM ${schema}.chunks
       WHERE content_type = 'spec' AND repo = $1
       ORDER BY file_path, ingested_at`,
      [repo],
    );
    return rows.map((r) => ({
      repo: r.repo as string,
      filePath: r.file_path as string,
      content: r.content as string,
      ingestedAt: r.ingested_at as string | Date,
    }));
  }

  async testChunkRanges(repo: string): Promise<TestChunkRange[]> {
    const schema = await this.resolveSchemaForRepo(repo);
    const { rows } = await this.pool.query(
      `SELECT file_path,
              (metadata->>'start_line')::int AS start_line,
              (metadata->>'end_line')::int   AS end_line
       FROM ${schema}.chunks
       WHERE repo = $1 AND content_type = 'code'`,
      [repo],
    );
    return rows.map((r) => ({
      filePath: r.file_path as string,
      startLine: (r.start_line as number | null) ?? null,
      endLine: (r.end_line as number | null) ?? null,
    }));
  }

  async specChunksForBackfill(repo: string): Promise<SpecChunkWithEmbedding[]> {
    const schema = await this.resolveSchemaForRepo(repo);
    const { rows } = await this.pool.query(
      `SELECT repo, file_path, content, ingested_at, embedding
       FROM ${schema}.chunks
       WHERE content_type = 'spec' AND repo = $1
       ORDER BY file_path, ingested_at`,
      [repo],
    );
    return rows.map((r) => ({
      repo: r.repo as string,
      filePath: r.file_path as string,
      content: r.content as string,
      ingestedAt: r.ingested_at as string | Date,
      embedding: r.embedding,
    }));
  }

  async codeChunksForBackfill(repo: string): Promise<CodeChunkFull[]> {
    const schema = await this.resolveSchemaForRepo(repo);
    const { rows } = await this.pool.query(
      `SELECT file_path, content, metadata, embedding
       FROM ${schema}.chunks
       WHERE repo = $1 AND content_type = 'code'`,
      [repo],
    );
    return rows.map((r) => ({
      filePath: r.file_path as string,
      content: r.content as string,
      metadata: (r.metadata as Record<string, unknown> | null) ?? null,
      embedding: r.embedding,
    }));
  }
}
