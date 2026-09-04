/** 1-hop knowledge-graph augmentation of memory search results: names mentioned in the direct hits get their graph neighbors appended below the worst direct score. */

import type { PgPool } from "../../memory-store.js";
import type { MemorySearchResult } from "./memory-search.js";

let entityNameCache: Set<string> = new Set();
let entityCacheUpdatedAt = 0;
const ENTITY_CACHE_TTL_MS = 5 * 60 * 1000; // 5 minutes

async function refreshEntityCache(pool: PgPool): Promise<void> {
  if (
    Date.now() - entityCacheUpdatedAt < ENTITY_CACHE_TTL_MS &&
    entityNameCache.size > 0
  ) {
    return;
  }

  try {
    const { rows } = await pool.query<{ name: string }>(
      `SELECT LOWER(name) as name FROM memory.entities`,
    );

    entityNameCache = new Set(rows.map((r) => r.name));
    entityCacheUpdatedAt = Date.now();
  } catch {
    // Keep stale cache on error
  }
}

function detectEntities(results: MemorySearchResult[]): string[] {
  const found = new Set<string>(
    results.flatMap((r) => {
      const text = `${r.key} ${r.value}`.toLowerCase();

      return [...entityNameCache].filter(
        (entity) => entity.length >= 3 && text.includes(entity),
      );
    }),
  );

  return [...found].slice(0, 5); // Max 5 entities to augment
}

/** Append one graph result per edge description not already in `seen`. */
function addUniqueEdgeResults(
  entity: string,
  rows: Array<{
    source_name: string;
    source_type: string;
    relation_type: string;
    target_name: string;
    target_type: string;
  }>,
  seen: Set<string>,
  results: MemorySearchResult[],
): void {
  for (const row of rows) {
    const desc = `${row.source_name} (${row.source_type}) --${row.relation_type}--> ${row.target_name} (${row.target_type})`;

    if (seen.has(desc)) {
      continue;
    }
    seen.add(desc);
    results.push({
      key: entity,
      value: desc,
      score: 0, // Will be set by caller
      agent_id: "graph",
      source: "graph",
    });
  }
}

async function graphAugment(
  pool: PgPool,
  entities: string[],
): Promise<MemorySearchResult[]> {
  if (entities.length === 0) {
    return [];
  }

  const results: MemorySearchResult[] = [];
  const seen = new Set<string>();

  for (const entity of entities) {
    try {
      const { rows } = await pool.query<{
        source_name: string;
        source_type: string;
        relation_type: string;
        target_name: string;
        target_type: string;
      }>(
        `SELECT s.name as source_name, s.entity_type as source_type,
                e.relation_type, t.name as target_name, t.entity_type as target_type
         FROM memory.edges e
         JOIN memory.entities s ON s.id = e.source_id
         JOIN memory.entities t ON t.id = e.target_id
         WHERE (LOWER(s.name) = $1 OR LOWER(t.name) = $1)
           AND e.valid_to IS NULL
         LIMIT 10`,
        [entity],
      );

      addUniqueEdgeResults(entity, rows, seen, results);
    } catch {
      // Skip this entity on error
    }
  }

  return results.slice(0, 10);
}

/** Append 1-hop graph neighbors below the worst direct result's score. */
export async function augmentWithGraphNeighbors(
  pool: PgPool,
  results: MemorySearchResult[],
  limit: number,
): Promise<MemorySearchResult[]> {
  await refreshEntityCache(pool);
  const entities = detectEntities(results);

  if (entities.length === 0) {
    return results;
  }
  const graphResults = await graphAugment(pool, entities);
  // Give graph results a lower score than the worst direct result
  const minScore =
    results.length > 0 ? results[results.length - 1].score * 0.5 : 0.001;
  const graphWithScores = graphResults.map((r, i) => ({
    ...r,
    score: minScore * (1 - i * 0.05), // Decreasing scores
  }));

  return [...results, ...graphWithScores].slice(0, limit);
}
