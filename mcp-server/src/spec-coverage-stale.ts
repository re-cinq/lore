/**
 * Lists specs whose link state is "stale" — anything the skill should
 * consider re-linking. Three flavours of stale:
 *
 *   1. The current `reassembleSpec(chunks)` hash differs from
 *      `spec_coverage_runs.content_hash` for that spec.
 *   2. The spec has never been linked (no `spec_coverage_runs` row).
 *   3. The spec was linked but has zero `spec_statements` rows (e.g.
 *      a rollback / mid-write crash left the table empty).
 *
 * No write. No LLM. Pure server-side bookkeeping over the existing
 * v2 tables plus chunk reassembly. Returns the metadata the skill
 * uses to decide what to surface first.
 */

import type { Pool } from "pg";
import { reassembleSpec, hashSpecContent } from "@re-cinq/lore-shared";
import { resolvePrepareSchema } from "./spec-coverage-prepare.js";

export interface StaleSpec {
  spec_path: string;
  current_hash: string;
  last_linked_hash: string | null;
  last_linked_at: string | null;
  last_linked_by: string | null;
  statements_count: number;
}

interface ChunkRow {
  file_path: string;
  content: string;
  ingested_at: string | Date;
}

interface RunRow {
  spec_path: string;
  content_hash: string;
  run_at: string | Date;
  linked_by: string | null;
}

interface StatementCountRow {
  spec_path: string;
  count: string | number;
}

export async function listStaleSpecCoverage(pool: Pool, repo: string): Promise<StaleSpec[]> {
  const schema = await resolvePrepareSchema(pool, repo);

  const { rows: specChunks } = await pool.query<ChunkRow>(
    `SELECT file_path, content, ingested_at
     FROM ${schema}.chunks
     WHERE content_type = 'spec' AND repo = $1
     ORDER BY file_path, ingested_at`,
    [repo],
  );
  if (specChunks.length === 0) return [];

  // Reassemble per spec_path and compute the current hash.
  const chunksByPath = new Map<string, ChunkRow[]>();
  for (const r of specChunks) {
    const list = chunksByPath.get(r.file_path) ?? [];
    list.push(r);
    chunksByPath.set(r.file_path, list);
  }
  const currentByPath = new Map<string, string>();
  for (const [path, chunks] of chunksByPath) {
    currentByPath.set(path, hashSpecContent(reassembleSpec(chunks)));
  }

  // Load previous runs (graceful when the table doesn't exist yet).
  let runRows: RunRow[] = [];
  try {
    const { rows } = await pool.query<RunRow>(
      `SELECT spec_path, content_hash, run_at, linked_by
       FROM ${schema}.spec_coverage_runs
       WHERE repo = $1`,
      [repo],
    );
    runRows = rows;
  } catch (err) {
    if ((err as { code?: string }).code !== "42P01") throw err;
  }
  const runByPath = new Map<string, RunRow>();
  for (const r of runRows) runByPath.set(r.spec_path, r);

  // Statement counts per spec (graceful when the table doesn't exist).
  let countRows: StatementCountRow[] = [];
  try {
    const { rows } = await pool.query<StatementCountRow>(
      `SELECT spec_path, count(*)::int AS count
       FROM ${schema}.spec_statements
       WHERE repo = $1
       GROUP BY spec_path`,
      [repo],
    );
    countRows = rows;
  } catch (err) {
    if ((err as { code?: string }).code !== "42P01") throw err;
  }
  const countByPath = new Map<string, number>();
  for (const r of countRows) countByPath.set(r.spec_path, Number(r.count));

  const stale: StaleSpec[] = [];
  for (const [path, currentHash] of currentByPath) {
    const run = runByPath.get(path);
    const statementsCount = countByPath.get(path) ?? 0;
    const isStale =
      !run || run.content_hash !== currentHash || statementsCount === 0;
    if (!isStale) continue;
    stale.push({
      spec_path: path,
      current_hash: currentHash,
      last_linked_hash: run?.content_hash ?? null,
      last_linked_at: run ? new Date(run.run_at).toISOString() : null,
      last_linked_by: run?.linked_by ?? null,
      statements_count: statementsCount,
    });
  }
  return stale;
}
