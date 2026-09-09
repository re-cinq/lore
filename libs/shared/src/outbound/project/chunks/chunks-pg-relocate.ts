import { enforceTrue } from "../../../lib/enforce.js";
import type { PgPool } from "../../memory-store.js";
import { enforceChunkSchema as enforceSchema } from "./chunk-schema.js";

/** Migrating a repo's legacy org_shared chunk rows onto its team schema — the one Floor-only chunk maintenance query left after the nightly reindex was retired (2026-09-08). */

/** Move-then-delete in ONE statement so a chunk is never in both schemas or neither. A row already present in the target is not moved but IS dropped from org_shared — the target copy is the newer one, and leaving the legacy row would keep serving it. */
function relocateSql(schema: string): string {
  return `WITH moved AS (
${movedCte(schema)}
     ),
     dropped AS (
${droppedCte(schema)}
     )
     SELECT (SELECT count(*) FROM moved)::text AS moved,
            (SELECT count(*) FROM dropped)::text AS dropped`;
}

/** The provenance stamp a relocated chunk carries. The `ingested_by` backfill is only applied to rows that predate that field — a chunk whose ingester IS recorded keeps its own provenance. */
const MIGRATED_METADATA_SQL = `coalesce(o.metadata, '{}'::jsonb)
           || jsonb_build_object('migrated_from', 'org_shared')
           || CASE
                WHEN o.metadata->>'ingested_by' IS NULL
                  AND o.content_type IN ('doc', 'code', 'adr', 'spec')
                THEN '{"ingested_by": "reindex-job"}'::jsonb
                ELSE '{}'::jsonb
              END`;

/** Copies each legacy chunk into the team schema, stamping where it came from. */
function movedCte(schema: string): string {
  return `       INSERT INTO ${schema}.chunks
         (id, content, embedding, content_type, team, repo, file_path,
          author, ingested_at, metadata)
       SELECT o.id, o.content, o.embedding, o.content_type, $2, o.repo,
         o.file_path, o.author, o.ingested_at,
         ${MIGRATED_METADATA_SQL}
       FROM org_shared.chunks o
       WHERE o.repo = $1
         AND NOT EXISTS (
           SELECT 1 FROM ${schema}.chunks t
           WHERE t.repo = o.repo AND t.file_path = o.file_path
         )
       ON CONFLICT (id) DO NOTHING
       RETURNING id`;
}

/** Clears the legacy rows: the ones just moved, and the ones that were skipped BECAUSE the target already holds them. The target copy is the newer one, so leaving the org_shared row behind would keep serving the stale text. */
function droppedCte(schema: string): string {
  return `       DELETE FROM org_shared.chunks o
       WHERE o.repo = $1
         AND (o.id IN (SELECT id FROM moved)
              OR EXISTS (
                SELECT 1 FROM ${schema}.chunks t
                WHERE t.repo = o.repo
                  AND (t.file_path = o.file_path OR t.id = o.id)
              ))
       RETURNING id`;
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
  const { rows } = await pool.query(relocateSql(schema), [repo, schema]);

  return {
    moved: Number(rows[0]?.moved || 0),
    dropped: Number(rows[0]?.dropped || 0),
  };
}
