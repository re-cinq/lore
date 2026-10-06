// The documents a context eval is written from: a repository's ingested ADRs and specs, read from the same chunks an agent's context is assembled from.

import type { PgPool } from "@re-cinq/lore-shared";
import { resolveChunkSchemaForRepo } from "@re-cinq/lore-shared/project/chunks/chunk-schema.js";

/** A document's path and the opening of its first chunk, where its status is written. */
export interface DocumentHead {
  path: string;
  head: string;
}

const CHUNK_ORDER =
  "(metadata->>'chunk_index')::int NULLS LAST, ingested_at, id";

// A plan, a task list or a research note sits beside a spec.md and decides nothing, so no question is written from one.
const EVAL_DOCUMENTS =
  "(content_type = 'adr' OR (content_type = 'spec' AND file_path LIKE '%spec.md'))";

const DEAD_STATUS = /^(retired|rejected|superseded|deprecated)\b/i;
const SPEC_STATUS = /^\|\s*Status\s*\|\s*([^|]+?)\s*\|/im;
const ADR_STATUS = /^status:\s*"?([^"\n]+?)"?\s*$/im;

/** The paths whose document is still in force: one that says it is retired, rejected, superseded or deprecated describes nothing an agent should be told. */
export function liveDocumentPaths(heads: DocumentHead[]): string[] {
  return heads
    .filter(({ head }) => !DEAD_STATUS.test(statusOf(head)))
    .map(({ path }) => path);
}

function statusOf(head: string): string {
  const match = SPEC_STATUS.exec(head) ?? ADR_STATUS.exec(head);

  return match ? match[1] : "";
}

export async function documentPaths(
  pool: PgPool,
  repo: string,
): Promise<string[]> {
  const schema = await resolveChunkSchemaForRepo(pool, repo);
  const { rows } = await pool.query<{ file_path: string; head: string }>(
    `SELECT DISTINCT ON (file_path) file_path, left(content, 1500) AS head
       FROM ${schema}.chunks
      WHERE repo = $1 AND ${EVAL_DOCUMENTS}
      ORDER BY file_path, ${CHUNK_ORDER}`,
    [repo],
  );

  return liveDocumentPaths(
    rows.map((row) => ({ path: row.file_path, head: row.head })),
  );
}

/** One document's ingested text, its chunks joined in order; null when the repository holds no ADR or spec at that path. */
export async function documentText(
  pool: PgPool,
  repo: string,
  path: string,
): Promise<string | null> {
  const schema = await resolveChunkSchemaForRepo(pool, repo);
  const { rows } = await pool.query<{ content: string }>(
    `SELECT content FROM ${schema}.chunks
      WHERE repo = $1 AND file_path = $2 AND ${EVAL_DOCUMENTS}
      ORDER BY ${CHUNK_ORDER}`,
    [repo, path],
  );

  return rows.length > 0 ? rows.map((row) => row.content).join("\n\n") : null;
}
