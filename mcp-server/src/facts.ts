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

// ── Main entry point ────────────────────────────────────────────────

export async function extractFacts(
  memoryId: string,
  value: string,
  pool: any,
): Promise<void> {
  try {
    const { provider, model } = getLlmConfig();

    // Call the LLM with retry (3 attempts, exponential backoff)
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

    // Insert each fact with its embedding
    for (const factText of facts) {
      try {
        const embedding = await getQueryEmbedding(factText);
        const embeddingStr = embedding ? `[${embedding.join(',')}]` : null;

        await pool.query(
          `INSERT INTO memory.facts (memory_id, fact_text, embedding)
           VALUES ($1, $2, $3)`,
          [memoryId, factText, embeddingStr],
        );
      } catch (err) {
        console.warn(`[facts] Failed to insert fact "${factText.substring(0, 50)}...":`, err);
        // Continue with remaining facts
      }
    }

    console.log(`[facts] Extracted and stored ${facts.length} facts for memory ${memoryId}`);
  } catch (err) {
    // Top-level catch: never throw from this function
    console.warn('[facts] Unexpected error during fact extraction:', err);
  }
}
