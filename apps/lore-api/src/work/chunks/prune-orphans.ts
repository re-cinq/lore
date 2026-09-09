import type { Pool } from "pg";
import { classifyFile, planChunkPrune } from "@re-cinq/lore-shared";
import { resolveChunkSchemaForRepo } from "@re-cinq/lore-shared/project/chunks/chunk-schema.js";

/** Deletes a repo's chunks whose path is gone from the tree at HEAD or refused by today's classifier. The caller posts the tree (`git ls-files`), so the store never has to guess what exists; an empty tree is refused at the route, because "nothing is present" would delete everything. */

// eslint-disable-next-line re-lint/no-row-types-outside-models -- the sweep's own report (which schema, which paths, how many rows went); no table has this shape
export interface PruneResult {
  schema: string;
  deleted_paths: string[];
  deleted_chunks: number;
}

export async function pruneOrphanChunks(
  pool: Pool,
  repo: string,
  presentPaths: string[],
): Promise<PruneResult> {
  const schema = await resolveChunkSchemaForRepo(pool, repo);
  const indexed = await indexedPaths(pool, schema, repo);
  const orphaned = planChunkPrune(indexed, presentPaths, classifyFile);

  return {
    schema,
    deleted_paths: orphaned,
    deleted_chunks: await deletePaths(pool, schema, repo, orphaned),
  };
}

async function indexedPaths(
  pool: Pool,
  schema: string,
  repo: string,
): Promise<string[]> {
  const { rows } = await pool.query<{ file_path: string }>(
    `SELECT DISTINCT file_path FROM ${schema}.chunks WHERE repo = $1 ORDER BY file_path`,
    [repo],
  );

  return rows.map((row) => row.file_path);
}

async function deletePaths(
  pool: Pool,
  schema: string,
  repo: string,
  paths: string[],
): Promise<number> {
  if (paths.length === 0) {
    return 0;
  }
  const { rowCount } = await pool.query(
    `DELETE FROM ${schema}.chunks WHERE repo = $1 AND file_path = ANY($2)`,
    [repo, paths],
  );

  return rowCount ?? 0;
}
