import type { Pool } from "pg";
import { stripCoverageLinks } from "@re-cinq/lore-shared";
import { listChunkSchemas } from "@re-cinq/lore-shared/project/chunks/chunk-schema.js";

/** Re-embeds rows the store holds without a usable vector, in bounded batches. Four weeks of a 403-ing embedder (2026-08-13 → 09-09) left every chunk, memory and fact written in that window with `embedding IS NULL`; `stale_links` re-embeds chunks whose vector was made before coverage links were stripped. Stops at the first null embedding, so a dead embedder costs one row rather than a batch. */

export type EmbedFn = (text: string) => Promise<number[] | null>;

export type BackfillWhere = "missing" | "stale_links";

export interface BackfillOptions {
  schema?: string;
  limit: number;
  where: BackfillWhere;
}

export interface BackfillResult {
  embedded: number;
  failed: number;
  remaining: number;
  stopped: boolean;
}

interface Target {
  table: string;
  textColumn: string;
  condition: string;
  markOnEmbed: boolean;
}

interface Tally {
  embedded: number;
  failed: number;
  stopped: boolean;
}

interface PendingRow {
  id: string;
  text: string;
}

// The marker keeps a re-embedded link carrier out of the next batch — the links stay in `content`, so the content match alone would select it forever.
const STALE_LINKS_CONDITION = `content ~ '\\(\\[(?:validated|implemented) by' AND COALESCE((metadata->>'embedded_stripped')::boolean, false) = false`;

const MEMORY_TARGETS: Target[] = [
  {
    table: "memory.memories",
    textColumn: "value",
    condition: "embedding IS NULL",
    markOnEmbed: false,
  },
  {
    table: "memory.facts",
    textColumn: "fact_text",
    condition: "embedding IS NULL",
    markOnEmbed: false,
  },
];

export async function backfillEmbeddings(
  pool: Pool,
  embed: EmbedFn,
  options: BackfillOptions,
): Promise<BackfillResult> {
  const targets = await targetsFor(pool, options);
  const tally: Tally = { embedded: 0, failed: 0, stopped: false };

  for (const target of targets) {
    const budget = options.limit - tally.embedded;

    if (tally.stopped || budget <= 0) {
      break;
    }
    const done = await embedTarget(pool, embed, target, budget);

    tally.embedded += done.embedded;
    tally.failed += done.failed;
    tally.stopped = done.stopped;
  }

  return { ...tally, remaining: await countPending(pool, targets) };
}

async function targetsFor(
  pool: Pool,
  { schema, where }: BackfillOptions,
): Promise<Target[]> {
  const schemas = schema ? [schema] : await listChunkSchemas(pool);
  const chunks = schemas.map((s) => chunkTarget(s, where));

  return where === "missing" ? [...chunks, ...MEMORY_TARGETS] : chunks;
}

function chunkTarget(schema: string, where: BackfillWhere): Target {
  return {
    table: `${schema}.chunks`,
    textColumn: "content",
    condition:
      where === "missing" ? "embedding IS NULL" : STALE_LINKS_CONDITION,
    markOnEmbed: where === "stale_links",
  };
}

async function embedTarget(
  pool: Pool,
  embed: EmbedFn,
  target: Target,
  budget: number,
): Promise<Tally> {
  let embedded = 0;

  for (const row of await pendingRows(pool, target, budget)) {
    const embedding = await embed(
      stripCoverageLinks(row.text).substring(0, 8000),
    );

    if (!embedding) {
      return { embedded, failed: 1, stopped: true };
    }
    await storeEmbedding(pool, target, row.id, embedding);
    embedded += 1;
  }

  return { embedded, failed: 0, stopped: false };
}

async function pendingRows(
  pool: Pool,
  target: Target,
  limit: number,
): Promise<PendingRow[]> {
  const { rows } = await pool.query<PendingRow>(
    `SELECT id, ${target.textColumn} AS text FROM ${target.table}
      WHERE ${target.condition} ORDER BY id LIMIT $1`,
    [limit],
  );

  return rows;
}

async function storeEmbedding(
  pool: Pool,
  target: Target,
  id: string,
  embedding: number[],
): Promise<void> {
  const marker = target.markOnEmbed
    ? `, metadata = COALESCE(metadata, '{}'::jsonb) || '{"embedded_stripped": true}'::jsonb`
    : "";

  await pool.query(
    `UPDATE ${target.table} SET embedding = $1::vector${marker} WHERE id = $2`,
    [`[${embedding.join(",")}]`, id],
  );
}

async function countPending(pool: Pool, targets: Target[]): Promise<number> {
  const counts = await Promise.all(
    targets.map(async (target) => {
      const { rows } = await pool.query<{ count: string }>(
        `SELECT COUNT(*) AS count FROM ${target.table} WHERE ${target.condition}`,
      );

      return Number(rows[0]?.count ?? 0);
    }),
  );

  return counts.reduce((sum, n) => sum + n, 0);
}
