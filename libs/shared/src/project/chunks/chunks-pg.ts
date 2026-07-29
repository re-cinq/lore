import { enforceTrue } from "../../lib/enforce.js";
import type { PgPool } from "../../memory-store.js";
import { resolveChunkSchemaForRepo } from "./chunk-schema.js";
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
    Error,
    `Invalid schema name: ${JSON.stringify(schema)}`,
  );
}

/**
 * Postgres-backed {@link ChunksPort}. SQL is lifted byte-for-byte from the
 * Floor reindex / context-core-builder jobs. Every `${schema}` query validates
 * the schema name first; only `distinctTeams`/`countChunksByTeam` still read
 * the fixed `org_shared.chunks` table — every repo-scoped detection read
 * resolves the repo's schema like the coverage reads do.
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

    return (rows[0]?.id as string) ?? null;
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

  async reindexOwnedFilePaths(schema: string, repo: string): Promise<string[]> {
    enforceSchema(schema);
    const { rows } = await this.pool.query(
      `SELECT DISTINCT file_path FROM ${schema}.chunks
       WHERE repo = $1 AND metadata->>'ingested_by' = 'reindex-job'`,
      [repo],
    );

    return rows.map((r) => r.file_path as string);
  }

  async touchChunksForFiles(
    schema: string,
    repo: string,
    filePaths: string[],
    minAgeDays: number,
  ): Promise<number> {
    enforceSchema(schema);
    const { rows } = await this.pool.query(
      `WITH due AS (
         SELECT file_path
         FROM ${schema}.chunks
         WHERE repo = $1 AND file_path = ANY($2::text[])
           AND metadata->>'ingested_by' = 'reindex-job'
         GROUP BY file_path
         HAVING min(ingested_at) < NOW() - ($3 || ' days')::interval
       )
       UPDATE ${schema}.chunks c
       SET ingested_at = NOW()
       WHERE c.repo = $1 AND c.file_path IN (SELECT file_path FROM due)
         AND c.metadata->>'ingested_by' = 'reindex-job'
       RETURNING c.id`,
      [repo, filePaths, String(minAgeDays)],
    );

    return rows.length;
  }

  async pruneChunksForFiles(
    schema: string,
    repo: string,
    filePaths: string[],
  ): Promise<number> {
    enforceSchema(schema);
    const { rows } = await this.pool.query(
      `DELETE FROM ${schema}.chunks
       WHERE repo = $1 AND file_path = ANY($2::text[])
         AND metadata->>'ingested_by' = 'reindex-job'
       RETURNING id`,
      [repo, filePaths],
    );

    return rows.length;
  }

  async relocateLegacyChunks(
    schema: string,
    repo: string,
  ): Promise<{ moved: number; dropped: number }> {
    enforceSchema(schema);
    enforceTrue(
      schema !== "org_shared",
      Error,
      "relocateLegacyChunks target must not be org_shared",
    );
    const { rows } = await this.pool.query(
      `WITH moved AS (
         INSERT INTO ${schema}.chunks
           (id, content, embedding, content_type, team, repo, file_path,
            author, ingested_at, metadata)
         SELECT o.id, o.content, o.embedding, o.content_type, $2, o.repo,
           o.file_path, o.author, o.ingested_at,
           coalesce(o.metadata, '{}'::jsonb)
             || jsonb_build_object('migrated_from', 'org_shared')
             || CASE
                  WHEN o.metadata->>'ingested_by' IS NULL
                    AND o.content_type IN ('doc', 'code', 'adr', 'spec')
                  THEN '{"ingested_by": "reindex-job"}'::jsonb
                  ELSE '{}'::jsonb
                END
         FROM org_shared.chunks o
         WHERE o.repo = $1
           AND NOT EXISTS (
             SELECT 1 FROM ${schema}.chunks t
             WHERE t.repo = o.repo AND t.file_path = o.file_path
           )
         ON CONFLICT (id) DO NOTHING
         RETURNING id
       ),
       dropped AS (
         DELETE FROM org_shared.chunks o
         WHERE o.repo = $1
           AND (o.id IN (SELECT id FROM moved)
                OR EXISTS (
                  SELECT 1 FROM ${schema}.chunks t
                  WHERE t.repo = o.repo
                    AND (t.file_path = o.file_path OR t.id = o.id)
                ))
         RETURNING id
       )
       SELECT (SELECT count(*) FROM moved)::text AS moved,
              (SELECT count(*) FROM dropped)::text AS dropped`,
      [repo, schema],
    );

    return {
      moved: Number(rows[0]?.moved || 0),
      dropped: Number(rows[0]?.dropped || 0),
    };
  }
}
