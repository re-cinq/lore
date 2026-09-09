// Contradiction detection: a new fact retires the still-valid facts it disagrees with, and the disagreement is recorded before either is changed.

import type { PgPool } from "@re-cinq/lore-shared";

const SIMILARITY_THRESHOLD = parseFloat(
  process.env.LORE_FACT_SIMILARITY_THRESHOLD || "0.92",
);

// Finds existing valid facts semantically similar to a new fact and invalidates them (valid_to, invalidated_by); fail-open — on any error the new fact is still inserted.
interface ContradictingFact {
  id: string;
  similarity: number;
}

// The still-valid facts closest to a new one. Only `valid_to IS NULL` rows are candidates: a fact already retired cannot be contradicted again, and re-invalidating it would rewrite history that has already been recorded.
const CONTRADICTING_SQL = `SELECT id, fact_text, 1 - (embedding <=> $1::vector) AS similarity
   FROM memory.facts f
   WHERE f.valid_to IS NULL
     AND f.id != $2
     AND f.embedding IS NOT NULL
     AND 1 - (f.embedding <=> $1::vector) >= $3
   ORDER BY similarity DESC
   LIMIT 5`;

async function findContradicting(
  pool: PgPool,
  newFactId: string,
  embeddingStr: string,
): Promise<ContradictingFact[]> {
  const { rows } = await pool.query(CONTRADICTING_SQL, [
    embeddingStr,
    newFactId,
    SIMILARITY_THRESHOLD,
  ]);

  return rows.map((r) => ({
    id: r.id as string,
    similarity: r.similarity as number,
  }));
}

/** The conflict is recorded BEFORE the fact is invalidated, so a crash between the two leaves evidence of the disagreement rather than a silently retired fact. */
async function invalidateFact(
  pool: PgPool,
  newFactId: string,
  contradicted: ContradictingFact,
): Promise<void> {
  await pool
    .query(
      `INSERT INTO memory.fact_conflicts (old_fact_id, new_fact_id, similarity)
         VALUES ($1, $2, $3)
         ON CONFLICT DO NOTHING`,
      [contradicted.id, newFactId, contradicted.similarity],
    )
    .catch(() => {});

  await pool.query(
    `UPDATE memory.facts
         SET valid_to = now(), invalidated_by = $1
         WHERE id = $2 AND valid_to IS NULL`,
    [newFactId, contradicted.id],
  );
}

// What was retired and how close it was. The similarity travels with each id, because "these two facts disagreed" is only reviewable if you can see how confident that judgement was.
function invalidationMetadata(
  newFactId: string,
  invalidated: ContradictingFact[],
) {
  return {
    new_fact_id: newFactId,
    invalidated: invalidated.map((r) => ({
      id: r.id,
      similarity: r.similarity,
    })),
  };
}

async function auditInvalidation(
  pool: PgPool,
  agentId: string,
  newFactId: string,
  invalidated: ContradictingFact[],
): Promise<void> {
  await pool
    .query(
      `INSERT INTO memory.audit_log (agent_id, operation, metadata)
         VALUES ($1, 'fact_invalidation', $2)`,
      [agentId, JSON.stringify(invalidationMetadata(newFactId, invalidated))],
    )
    .catch(() => {});
}

// Retires every fact the new one contradicts, and records that it did. The audit entry comes last: the invalidations are the durable change, and an agentless call (a fact with no owner) still performs them.
async function retireContradicted(
  pool: PgPool,
  newFactId: string,
  embeddingStr: string,
  agentId: string | null,
): Promise<number> {
  const rows = await findContradicting(pool, newFactId, embeddingStr);

  if (rows.length === 0) {
    return 0;
  }

  for (const row of rows) {
    await invalidateFact(pool, newFactId, row);
  }

  if (agentId) {
    await auditInvalidation(pool, agentId, newFactId, rows);
  }

  return rows.length;
}

export async function invalidateContradictions(
  pool: PgPool,
  newFactId: string,
  embeddingStr: string,
  agentId: string | null,
): Promise<number> {
  try {
    return await retireContradicted(pool, newFactId, embeddingStr, agentId);
  } catch (err) {
    console.warn("[facts] Contradiction detection failed (non-fatal):", err);

    return 0;
  }
}
