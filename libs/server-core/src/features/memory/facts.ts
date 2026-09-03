// Async fact extraction via configurable LLM: extracts factual statements from memory values, embeds and stores them in memory.facts for granular search. Never throws — a failed extraction must not break the write path.

import { getQueryEmbedding } from "../../platform/db.js";
import { Llm } from "@re-cinq/lore-shared";
import type { PgPool } from "@re-cinq/lore-shared";

// Provider selection (Anthropic/OpenAI/Ollama) + cost logging live behind the shared `Llm` singleton (LORE_LLM_PROVIDER / LORE_FACT_LLM); fact extraction just calls `Llm.instance.complete`.

const EXTRACTION_PROMPT =
  "Extract individual factual statements from the following text. " +
  "Return a JSON array of strings. Each fact should be a single, " +
  "self-contained statement. Maximum 10 facts.";

// ── Retry helper ────────────────────────────────────────────────────

async function withRetry<T>(
  fn: () => Promise<T>,
  attempts: number = 3,
  baseDelayMs: number = 1000,
): Promise<T> {
  for (let i = 0; i < attempts; i++) {
    try {
      return await fn();
    } catch (err) {
      if (i === attempts - 1) {
        throw err;
      }
      const delay = baseDelayMs * Math.pow(3, i); // 1s, 3s, 9s

      await new Promise((resolve) => setTimeout(resolve, delay));
    }
  }
  // Unreachable, but satisfies TypeScript
  throw new Error("retry exhausted");
}

// ── Response parsing ────────────────────────────────────────────────

export function parseFacts(raw: string): string[] {
  // Try JSON parse first
  try {
    // The LLM may wrap the array in markdown code fences
    const cleaned = raw
      .replace(/```json?\s*/g, "")
      .replace(/```/g, "")
      .trim();
    const parsed = JSON.parse(cleaned);

    if (Array.isArray(parsed)) {
      return parsed
        .filter(
          (f): f is string => typeof f === "string" && f.trim().length > 0,
        )
        .slice(0, 10);
    }
  } catch {
    // Fall through to newline fallback
  }

  // Fallback: split by newlines, strip list markers
  return raw
    .split("\n")
    .map((line) => line.replace(/^\s*[-*\d.)\]]+\s*/, "").trim())
    .filter((line) => line.length > 0)
    .slice(0, 10);
}

// ── Contradiction detection ─────────────────────────────────────────

const SIMILARITY_THRESHOLD = parseFloat(
  process.env.LORE_FACT_SIMILARITY_THRESHOLD || "0.92",
);

// Finds existing valid facts semantically similar to a new fact and invalidates them (valid_to, invalidated_by); fail-open — on any error the new fact is still inserted.
async function invalidateContradictions(
  pool: PgPool,
  newFactId: string,
  embeddingStr: string,
  agentId: string | null,
): Promise<number> {
  try {
    const { rows } = await pool.query(
      `SELECT id, fact_text, 1 - (embedding <=> $1::vector) AS similarity
       FROM memory.facts f
       WHERE f.valid_to IS NULL
         AND f.id != $2
         AND f.embedding IS NOT NULL
         AND 1 - (f.embedding <=> $1::vector) >= $3
       ORDER BY similarity DESC
       LIMIT 5`,
      [embeddingStr, newFactId, SIMILARITY_THRESHOLD],
    );

    if (rows.length === 0) {
      return 0;
    }

    for (const row of rows) {
      // Record the conflict before invalidating
      await pool
        .query(
          `INSERT INTO memory.fact_conflicts (old_fact_id, new_fact_id, similarity)
         VALUES ($1, $2, $3)
         ON CONFLICT DO NOTHING`,
          [row.id, newFactId, row.similarity],
        )
        .catch(() => {});

      await pool.query(
        `UPDATE memory.facts
         SET valid_to = now(), invalidated_by = $1
         WHERE id = $2 AND valid_to IS NULL`,
        [newFactId, row.id],
      );
    }

    if (agentId) {
      await pool
        .query(
          `INSERT INTO memory.audit_log (agent_id, operation, metadata)
         VALUES ($1, 'fact_invalidation', $2)`,
          [
            agentId,
            JSON.stringify({
              new_fact_id: newFactId,
              invalidated: rows.map((r) => ({
                id: r.id as string,
                similarity: r.similarity as number,
              })),
            }),
          ],
        )
        .catch(() => {});
    }

    return rows.length;
  } catch (err) {
    console.warn("[facts] Contradiction detection failed (non-fatal):", err);

    return 0;
  }
}

async function getAgentIdForMemory(
  pool: PgPool,
  memoryId: string,
): Promise<string | null> {
  try {
    const { rows } = await pool.query(
      `SELECT agent_id FROM memory.memories WHERE id = $1`,
      [memoryId],
    );

    return (rows[0]?.agent_id as string) || null;
  } catch {
    return null;
  }
}

// ── Main entry point ────────────────────────────────────────────────

export async function extractFacts(
  memoryId: string,
  value: string,
  pool: PgPool,
): Promise<void> {
  try {
    let rawResponse: string;

    try {
      rawResponse = await withRetry(() =>
        Llm.instance
          .complete({
            systemPrompt: EXTRACTION_PROMPT,
            prompt: value,
            jobName: "fact-extraction",
          })
          .then((r) => r.text),
      );
    } catch (err) {
      console.warn(
        "[facts] LLM unreachable after 3 attempts, skipping fact extraction:",
        err,
      );

      return;
    }

    const facts = parseFacts(rawResponse);

    if (facts.length === 0) {
      console.warn("[facts] No facts extracted from LLM response");

      return;
    }

    const agentId = await getAgentIdForMemory(pool, memoryId);
    let totalInvalidated = 0;

    for (const factText of facts) {
      try {
        const embedding = await getQueryEmbedding(factText);
        const embeddingStr = embedding ? `[${embedding.join(",")}]` : null;

        const { rows } = await pool.query(
          `INSERT INTO memory.facts (memory_id, fact_text, embedding, valid_from, confidence)
           VALUES ($1, $2, $3, now(), 'inferred')
           RETURNING id`,
          [memoryId, factText, embeddingStr],
        );

        if (embeddingStr && rows[0]?.id) {
          const invalidated = await invalidateContradictions(
            pool,
            rows[0].id as string,
            embeddingStr,
            agentId,
          );

          totalInvalidated += invalidated;
        }
      } catch (err) {
        console.warn(
          `[facts] Failed to insert fact "${factText.substring(0, 50)}...":`,
          err,
        );
      }
    }

    const invalidMsg =
      totalInvalidated > 0
        ? `, invalidated ${totalInvalidated} stale facts`
        : "";

    console.log(
      `[facts] Extracted and stored ${facts.length} facts for memory ${memoryId}${invalidMsg}`,
    );
  } catch (err) {
    console.warn("[facts] Unexpected error during fact extraction:", err);
  }
}

// Extract facts from an episode (same pipeline, different source column).
export async function extractFactsFromEpisode(
  episodeId: string,
  content: string,
  agentId: string,
  pool: PgPool,
): Promise<void> {
  try {
    let rawResponse: string;

    try {
      rawResponse = await withRetry(() =>
        Llm.instance
          .complete({
            systemPrompt: EXTRACTION_PROMPT,
            prompt: content,
            jobName: "fact-extraction",
          })
          .then((r) => r.text),
      );
    } catch (err) {
      console.warn("[facts] LLM unreachable for episode extraction:", err);

      return;
    }

    const facts = parseFacts(rawResponse);

    if (facts.length === 0) {
      return;
    }

    let totalInvalidated = 0;

    for (const factText of facts) {
      try {
        const embedding = await getQueryEmbedding(factText);
        const embeddingStr = embedding ? `[${embedding.join(",")}]` : null;

        const { rows } = await pool.query(
          `INSERT INTO memory.facts (episode_id, fact_text, embedding, valid_from)
           VALUES ($1, $2, $3, now())
           RETURNING id`,
          [episodeId, factText, embeddingStr],
        );

        if (embeddingStr && rows[0]?.id) {
          const invalidated = await invalidateContradictions(
            pool,
            rows[0].id as string,
            embeddingStr,
            agentId,
          );

          totalInvalidated += invalidated;
        }
      } catch (err) {
        console.warn(
          `[facts] Failed to insert episode fact "${factText.substring(0, 50)}...":`,
          err,
        );
      }
    }

    const invalidMsg =
      totalInvalidated > 0
        ? `, invalidated ${totalInvalidated} stale facts`
        : "";

    console.log(
      `[facts] Extracted ${facts.length} facts from episode ${episodeId}${invalidMsg}`,
    );
  } catch (err) {
    console.warn(
      "[facts] Unexpected error during episode fact extraction:",
      err,
    );
  }
}
