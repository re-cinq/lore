import { enforceTrue } from "../../lib/enforce.js";
import type { PgPool } from "../../memory-store.js";
import { enforceChunkSchema as enforceSchema } from "./chunk-schema.js";

/** The reindex-job maintenance queries of {@link PgChunks} — which files a repo's reindex-job chunks own, aging them out, pruning them, and migrating legacy org_shared rows onto a team schema. */
export async function reindexOwnedFilePaths(
  pool: PgPool,
  schema: string,
  repo: string,
): Promise<string[]> {
  enforceSchema(schema);
  const { rows } = await pool.query(
    `SELECT DISTINCT file_path FROM ${schema}.chunks
     WHERE repo = $1 AND metadata->>'ingested_by' = 'reindex-job'`,
    [repo],
  );

  return rows.map((r) => r.file_path as string);
}

export async function chunkedFilePaths(
  pool: PgPool,
  schema: string,
  repo: string,
): Promise<string[]> {
  enforceSchema(schema);
  const { rows } = await pool.query(
    `SELECT DISTINCT file_path FROM ${schema}.chunks
     WHERE repo = $1`,
    [repo],
  );

  return rows.map((r) => r.file_path as string);
}

export async function staleChunkerFiles(
  pool: PgPool,
  schema: string,
  opts: { repo: string; version: number; limit: number },
): Promise<string[]> {
  enforceSchema(schema);
  const { rows } = await pool.query(
    `SELECT DISTINCT file_path FROM ${schema}.chunks
     WHERE repo = $1 AND content_type = 'code'
       AND COALESCE((metadata->>'chunker_version')::int, 0) < $2
     ORDER BY file_path
     LIMIT $3`,
    [opts.repo, opts.version, opts.limit],
  );

  return rows.map((r) => r.file_path as string);
}

export async function touchChunksForFiles(
  pool: PgPool,
  schema: string,
  opts: { repo: string; filePaths: string[]; minAgeDays: number },
): Promise<number> {
  enforceSchema(schema);
  const { rows } = await pool.query(
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
    [opts.repo, opts.filePaths, String(opts.minAgeDays)],
  );

  return rows.length;
}

export async function pruneChunksForFiles(
  pool: PgPool,
  schema: string,
  repo: string,
  filePaths: string[],
): Promise<number> {
  enforceSchema(schema);
  const { rows } = await pool.query(
    `DELETE FROM ${schema}.chunks
     WHERE repo = $1 AND file_path = ANY($2::text[])
       AND metadata->>'ingested_by' = 'reindex-job'
     RETURNING id`,
    [repo, filePaths],
  );

  return rows.length;
}

export async function relocateLegacyChunks(
  pool: PgPool,
  schema: string,
  repo: string,
): Promise<{ moved: number; dropped: number }> {
  enforceSchema(schema);
  enforceTrue(
    schema !== "org_shared",
    Error,
    "relocateLegacyChunks target must not be org_shared",
  );
  const { rows } = await pool.query(
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
