/**
 * Async fact extraction via configurable LLM.
 *
 * Extracts individual factual statements from memory values, embeds each
 * fact, and stores them in memory.facts for granular semantic search.
 * Supports Claude, OpenAI, and Ollama as LLM backends.
 *
 * Never throws — a failed extraction must not break the write path.
 */

import { getQueryEmbedding } from './db.js';

// ── LLM provider configuration ──────────────────────────────────────

type LlmProvider = 'claude' | 'openai' | 'ollama';

function getLlmConfig(): { provider: LlmProvider; model: string } {
  const provider = (process.env.LORE_FACT_LLM || 'claude') as LlmProvider;
  const model = process.env.LORE_FACT_MODEL || defaultModel(provider);
  return { provider, model };
}

function defaultModel(provider: LlmProvider): string {
  switch (provider) {
    case 'claude':  return 'claude-sonnet-4-20250514';
    case 'openai':  return 'gpt-4o-mini';
    case 'ollama':  return 'llama3';
  }
}

const EXTRACTION_PROMPT =
  'Extract individual factual statements from the following text. ' +
  'Return a JSON array of strings. Each fact should be a single, ' +
  'self-contained statement. Maximum 10 facts.';

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
      if (i === attempts - 1) throw err;
      const delay = baseDelayMs * Math.pow(3, i); // 1s, 3s, 9s
      await new Promise((resolve) => setTimeout(resolve, delay));
    }
  }
  // Unreachable, but satisfies TypeScript
  throw new Error('retry exhausted');
}

// ── LLM provider implementations ────────────────────────────────────

async function callClaude(model: string, text: string): Promise<string> {
  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) throw new Error('ANTHROPIC_API_KEY not set');

  const res = await fetch('https://api.anthropic.com/v1/messages', {
    method: 'POST',
    headers: {
      'x-api-key': apiKey,
      'anthropic-version': '2023-06-01',
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      model,
      max_tokens: 1024,
      messages: [
        { role: 'user', content: `${EXTRACTION_PROMPT}\n\n${text}` },
      ],
    }),
  });

  if (!res.ok) {
    throw new Error(`Claude API error: ${res.status} ${res.statusText}`);
  }

  const json = await res.json() as {
    content: Array<{ type: string; text: string }>;
  };
  return json.content[0].text;
}

async function callOpenAI(model: string, text: string): Promise<string> {
  const apiKey = process.env.OPENAI_API_KEY;
  if (!apiKey) throw new Error('OPENAI_API_KEY not set');

  const res = await fetch('https://api.openai.com/v1/chat/completions', {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${apiKey}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      model,
      messages: [
        { role: 'system', content: EXTRACTION_PROMPT },
        { role: 'user', content: text },
      ],
      temperature: 0,
    }),
  });

  if (!res.ok) {
    throw new Error(`OpenAI API error: ${res.status} ${res.statusText}`);
  }

  const json = await res.json() as {
    choices: Array<{ message: { content: string } }>;
  };
  return json.choices[0].message.content;
}

async function callOllama(model: string, text: string): Promise<string> {
  const baseUrl = process.env.LORE_OLLAMA_URL || 'http://localhost:11434';

  const res = await fetch(`${baseUrl}/api/generate`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      model,
      prompt: `${EXTRACTION_PROMPT}\n\n${text}`,
      stream: false,
    }),
  });

  if (!res.ok) {
    throw new Error(`Ollama API error: ${res.status} ${res.statusText}`);
  }

  const json = await res.json() as { response: string };
  return json.response;
}

// ── Response parsing ────────────────────────────────────────────────

function parseFacts(raw: string): string[] {
  // Try JSON parse first
  try {
    // The LLM may wrap the array in markdown code fences
    const cleaned = raw.replace(/```json?\s*/g, '').replace(/```/g, '').trim();
    const parsed = JSON.parse(cleaned);
    if (Array.isArray(parsed)) {
      return parsed
        .filter((f): f is string => typeof f === 'string' && f.trim().length > 0)
        .slice(0, 10);
    }
  } catch {
    // Fall through to newline fallback
  }

  // Fallback: split by newlines, strip list markers
  return raw
    .split('\n')
    .map((line) => line.replace(/^\s*[-*\d.)\]]+\s*/, '').trim())
    .filter((line) => line.length > 0)
    .slice(0, 10);
}

// ── Contradiction detection ─────────────────────────────────────────

const SIMILARITY_THRESHOLD = parseFloat(
  process.env.LORE_FACT_SIMILARITY_THRESHOLD || '0.92',
);

/**
 * Find existing valid facts that are semantically similar to a new fact
 * and invalidate them (set valid_to, invalidated_by). Fail-open: if
 * anything goes wrong, the new fact is still inserted.
 */
async function invalidateContradictions(
  pool: any,
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

    if (rows.length === 0) return 0;

    for (const row of rows) {
      await pool.query(
        `UPDATE memory.facts
         SET valid_to = now(), invalidated_by = $1
         WHERE id = $2 AND valid_to IS NULL`,
        [newFactId, row.id],
      );
    }

    if (agentId) {
      await pool.query(
        `INSERT INTO memory.audit_log (agent_id, operation, metadata)
         VALUES ($1, 'fact_invalidation', $2)`,
        [agentId, JSON.stringify({
          new_fact_id: newFactId,
          invalidated: rows.map((r: any) => ({ id: r.id, similarity: r.similarity })),
        })],
      ).catch(() => {});
    }

    return rows.length;
  } catch (err) {
    console.warn('[facts] Contradiction detection failed (non-fatal):', err);
    return 0;
  }
}

async function getAgentIdForMemory(
  pool: any,
  memoryId: string,
): Promise<string | null> {
  try {
    const { rows } = await pool.query(
      `SELECT agent_id FROM memory.memories WHERE id = $1`,
      [memoryId],
    );
    return rows[0]?.agent_id || null;
  } catch {
    return null;
  }
}

// ── Main entry point ────────────────────────────────────────────────

export async function extractFacts(
  memoryId: string,
  value: string,
  pool: any,
): Promise<void> {
  try {
    const { provider, model } = getLlmConfig();

    let rawResponse: string;
    try {
      rawResponse = await withRetry(() => {
        switch (provider) {
          case 'claude':  return callClaude(model, value);
          case 'openai':  return callOpenAI(model, value);
          case 'ollama':  return callOllama(model, value);
          default:        return callClaude(model, value);
        }
      });
    } catch (err) {
      console.warn('[facts] LLM unreachable after 3 attempts, skipping fact extraction:', err);
      return;
    }

    const facts = parseFacts(rawResponse);

    if (facts.length === 0) {
      console.warn('[facts] No facts extracted from LLM response');
      return;
    }

    const agentId = await getAgentIdForMemory(pool, memoryId);
    let totalInvalidated = 0;

    for (const factText of facts) {
      try {
        const embedding = await getQueryEmbedding(factText);
        const embeddingStr = embedding ? `[${embedding.join(',')}]` : null;

        const { rows } = await pool.query(
          `INSERT INTO memory.facts (memory_id, fact_text, embedding, valid_from)
           VALUES ($1, $2, $3, now())
           RETURNING id`,
          [memoryId, factText, embeddingStr],
        );

        if (embeddingStr && rows[0]?.id) {
          const invalidated = await invalidateContradictions(
            pool, rows[0].id, embeddingStr, agentId,
          );
          totalInvalidated += invalidated;
        }
      } catch (err) {
        console.warn(`[facts] Failed to insert fact "${factText.substring(0, 50)}...":`, err);
      }
    }

    const invalidMsg = totalInvalidated > 0 ? `, invalidated ${totalInvalidated} stale facts` : '';
    console.log(`[facts] Extracted and stored ${facts.length} facts for memory ${memoryId}${invalidMsg}`);
  } catch (err) {
    console.warn('[facts] Unexpected error during fact extraction:', err);
  }
}

/**
 * Extract facts from an episode (same pipeline, different source column).
 */
export async function extractFactsFromEpisode(
  episodeId: string,
  content: string,
  agentId: string,
  pool: any,
): Promise<void> {
  try {
    const { provider, model } = getLlmConfig();

    let rawResponse: string;
    try {
      rawResponse = await withRetry(() => {
        switch (provider) {
          case 'claude':  return callClaude(model, content);
          case 'openai':  return callOpenAI(model, content);
          case 'ollama':  return callOllama(model, content);
          default:        return callClaude(model, content);
        }
      });
    } catch (err) {
      console.warn('[facts] LLM unreachable for episode extraction:', err);
      return;
    }

    const facts = parseFacts(rawResponse);
    if (facts.length === 0) return;

    let totalInvalidated = 0;

    for (const factText of facts) {
      try {
        const embedding = await getQueryEmbedding(factText);
        const embeddingStr = embedding ? `[${embedding.join(',')}]` : null;

        const { rows } = await pool.query(
          `INSERT INTO memory.facts (episode_id, fact_text, embedding, valid_from)
           VALUES ($1, $2, $3, now())
           RETURNING id`,
          [episodeId, factText, embeddingStr],
        );

        if (embeddingStr && rows[0]?.id) {
          const invalidated = await invalidateContradictions(
            pool, rows[0].id, embeddingStr, agentId,
          );
          totalInvalidated += invalidated;
        }
      } catch (err) {
        console.warn(`[facts] Failed to insert episode fact "${factText.substring(0, 50)}...":`, err);
      }
    }

    const invalidMsg = totalInvalidated > 0 ? `, invalidated ${totalInvalidated} stale facts` : '';
    console.log(`[facts] Extracted ${facts.length} facts from episode ${episodeId}${invalidMsg}`);
  } catch (err) {
    console.warn('[facts] Unexpected error during episode fact extraction:', err);
  }
}
