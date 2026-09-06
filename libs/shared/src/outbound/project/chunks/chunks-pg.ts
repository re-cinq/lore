import type { PgPool } from "../../memory-store.js";
import {
  enforceChunkSchema as enforceSchema,
  resolveChunkSchemaForRepo,
} from "./chunk-schema.js";
import * as reindex from "./chunks-pg-reindex.js";
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

export { enforceChunkSchema as enforceSchema } from "./chunk-schema.js";

/** Postgres-backed {@link ChunksPort}: every `${schema}` query validates the schema name first. */
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

    return (rows.at(0)?.id as string | undefined) ?? null;
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

    return parseInt((rows[0]?.count as string) || "0", 10);
  }

  async specChunks(repo: string): Promise<SpecChunkRow[]> {
    const schema = await this.resolveSchemaForRepo(repo);
    const { rows } = await this.pool.query(
      `SELECT id, repo, file_path, content
       FROM ${schema}.chunks
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
    const schema = await this.resolveSchemaForRepo(repo);
    const { rows } = await this.pool.query(
      `SELECT metadata->>'symbol_name' AS symbol_name,
              metadata->>'symbol_type' AS symbol_type,
              file_path
       FROM ${schema}.chunks
       WHERE repo = $1
         AND content_type = 'code'
         AND metadata->>'symbol_name' IS NOT NULL
         AND metadata->>'symbol_type' IS DISTINCT FROM 'call'`,
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
    const schema = await this.resolveSchemaForRepo(repo);
    const { rows } = await this.pool.query(
      `SELECT id FROM ${schema}.chunks
       WHERE repo = $1 AND content_type = $2
         ${fileSuffix ? "AND file_path LIKE $3" : ""}
       LIMIT 1`,
      fileSuffix ? [repo, contentType, `%${fileSuffix}`] : [repo, contentType],
    );

    return rows.length > 0;
  }

  async staleChunkCount(repo: string, olderThanDays: number): Promise<number> {
    const schema = await this.resolveSchemaForRepo(repo);
    const { rows } = await this.pool.query(
      `SELECT COUNT(*) AS count FROM ${schema}.chunks
       WHERE repo = $1
         AND ingested_at < NOW() - ($2 || ' days')::interval
         AND metadata->>'ingested_by' = 'reindex-job'`,
      [repo, String(olderThanDays)],
    );

    return parseInt((rows[0]?.count as string) || "0", 10);
  }

  private resolveSchemaForRepo(repo: string): Promise<string> {
    return resolveChunkSchemaForRepo(this.pool, repo);
  }

  async specChunksWithIngest(repo: string): Promise<SpecChunkWithIngest[]> {
    const schema = await this.resolveSchemaForRepo(repo);
    const { rows } = await this.pool.query(
      `SELECT repo, file_path, content, ingested_at,
              (metadata->>'chunk_index')::int AS chunk_index
       FROM ${schema}.chunks
       WHERE content_type = 'spec' AND repo = $1
       ORDER BY file_path, (metadata->>'chunk_index')::int NULLS LAST, ingested_at, id`,
      [repo],
    );

    return rows.map((r) => ({
      repo: r.repo as string,
      filePath: r.file_path as string,
      content: r.content as string,
      ingestedAt: r.ingested_at as string | Date,
      chunkIndex: (r.chunk_index as number | null) ?? null,
    }));
  }

  async testChunkRanges(repo: string): Promise<TestChunkRange[]> {
    const schema = await this.resolveSchemaForRepo(repo);
    const { rows } = await this.pool.query(
      `SELECT file_path,
              (metadata->>'start_line')::int AS start_line,
              (metadata->>'end_line')::int   AS end_line,
              ingested_at
       FROM ${schema}.chunks
       WHERE repo = $1 AND content_type = 'code'`,
      [repo],
    );

    return rows.map((r) => ({
      filePath: r.file_path as string,
      startLine: (r.start_line as number | null) ?? null,
      endLine: (r.end_line as number | null) ?? null,
      ingestedAt: (r.ingested_at as string | Date | null) ?? null,
    }));
  }

  async specChunksForBackfill(repo: string): Promise<SpecChunkWithEmbedding[]> {
    const schema = await this.resolveSchemaForRepo(repo);
    const { rows } = await this.pool.query(
      `SELECT repo, file_path, content, ingested_at, embedding,
              (metadata->>'chunk_index')::int AS chunk_index
       FROM ${schema}.chunks
       WHERE content_type = 'spec' AND repo = $1
       ORDER BY file_path, (metadata->>'chunk_index')::int NULLS LAST, ingested_at, id`,
      [repo],
    );

    return rows.map((r) => ({
      repo: r.repo as string,
      filePath: r.file_path as string,
      content: r.content as string,
      ingestedAt: r.ingested_at as string | Date,
      chunkIndex: (r.chunk_index as number | null) ?? null,
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

  reindexOwnedFilePaths(schema: string, repo: string): Promise<string[]> {
    return reindex.reindexOwnedFilePaths(this.pool, schema, repo);
  }

  chunkedFilePaths(schema: string, repo: string): Promise<string[]> {
    return reindex.chunkedFilePaths(this.pool, schema, repo);
  }

  staleChunkerFiles(
    schema: string,
    repo: string,
    version: number,
    limit: number,
  ): Promise<string[]> {
    return reindex.staleChunkerFiles(this.pool, schema, {
      repo,
      version,
      limit,
    });
  }

  touchChunksForFiles(
    schema: string,
    repo: string,
    filePaths: string[],
    minAgeDays: number,
  ): Promise<number> {
    return reindex.touchChunksForFiles(this.pool, schema, {
      repo,
      filePaths,
      minAgeDays,
    });
  }

  pruneChunksForFiles(
    schema: string,
    repo: string,
    filePaths: string[],
  ): Promise<number> {
    return reindex.pruneChunksForFiles(this.pool, schema, repo, filePaths);
  }

  relocateLegacyChunks(
    schema: string,
    repo: string,
  ): Promise<{ moved: number; dropped: number }> {
    return reindex.relocateLegacyChunks(this.pool, schema, repo);
  }
}
