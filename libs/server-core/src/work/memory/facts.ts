// Async fact extraction via configurable LLM: extracts factual statements from memory values, embeds and stores them in memory.facts for granular search. Never throws — a failed extraction must not break the write path.

import { getQueryEmbedding } from "../../outbound/db.js";
import { Llm } from "@re-cinq/lore-shared";
import type { PgPool } from "@re-cinq/lore-shared";
import { invalidateContradictions } from "./fact-contradictions.js";

// Provider selection (Anthropic/Gemini/Ollama) + cost logging live behind the shared `Llm` singleton (LORE_LLM_PROVIDER / LORE_FACT_LLM); fact extraction just calls `Llm.instance.complete`.

const EXTRACTION_PROMPT =
  "Extract individual factual statements from the following text. " +
  "Return a JSON array of strings. Each fact should be a single, " +
  "self-contained statement. Maximum 10 facts.";

type FactInsert = (
  factText: string,
  embedding: string | null,
) => Promise<{ rows: Array<{ id?: unknown }> }>;

// ── Response parsing ────────────────────────────────────────────────

export function parseFacts(raw: string): string[] {
  const parsed = parseFactArray(raw);

  if (parsed) {
    return parsed;
  }

  // Fallback: split by newlines, strip list markers
  return raw
    .split("\n")
    .map((line) => line.replace(/^\s*[-*\d.)\]]+\s*/, "").trim())
    .filter((line) => line.length > 0)
    .slice(0, 10);
}

// The model's array, when it produced one. Fences are stripped first because the model wraps JSON in markdown as often as not; anything that still will not parse returns null so the caller falls back to reading it line by line.
function parseFactArray(raw: string): string[] | null {
  try {
    const cleaned = raw
      .replace(/```json?\s*/g, "")
      .replace(/```/g, "")
      .trim();
    const parsed = JSON.parse(cleaned);

    if (!Array.isArray(parsed)) {
      return null;
    }

    return parsed
      .filter((f): f is string => typeof f === "string" && f.trim().length > 0)
      .slice(0, 10);
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
    const facts = await extractFactTexts(value, "memory");

    if (!hasFacts(facts)) {
      return;
    }
    await storeAndReport(pool, facts, {
      agentId: await getAgentIdForMemory(pool, memoryId),
      insert: memoryFactInsert(pool, memoryId),
      subject: `memory ${memoryId}`,
    });
  } catch (err) {
    console.warn("[facts] Unexpected error during fact extraction:", err);
  }
}

// Whether there is anything to store. An EMPTY array is warned about but a null is not: null means the model was unreachable and has already been logged, while empty means it answered and found nothing worth recording, which is worth noticing.
function hasFacts(facts: string[] | null): facts is string[] {
  if (facts?.length === 0) {
    console.warn("[facts] No facts extracted from LLM response");
  }

  return Boolean(facts && facts.length > 0);
}

// Inserts one extracted fact against its memory. Confidence is `inferred`, not `observed`: a memory is something an agent chose to write down, so a fact derived from it is one step further from what was actually seen.
function memoryFactInsert(pool: PgPool, memoryId: string): FactInsert {
  return (factText, embedding) =>
    pool.query(
      `INSERT INTO memory.facts (memory_id, fact_text, embedding, valid_from, confidence)
         VALUES ($1, $2, $3, now(), 'inferred')
         RETURNING id`,
      [memoryId, factText, embedding],
    );
}

// Stores the batch and says what it did. Both entry points share this — a memory and an episode differ only in which column the fact hangs off and what the log line calls it.
async function storeAndReport(
  pool: PgPool,
  facts: string[],
  target: { agentId: string | null; insert: FactInsert; subject: string },
): Promise<void> {
  const invalidated = await storeFacts(
    pool,
    facts,
    target.agentId,
    target.insert,
  );

  console.log(
    `[facts] Extracted and stored ${facts.length} facts for ${target.subject}${invalidatedNote(invalidated)}`,
  );
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

/** The facts an LLM finds in one blob, or null when it could not be reached. An unreachable model costs the extraction, never the write that triggered it. */
async function extractFactTexts(
  value: string,
  source: "memory" | "episode",
): Promise<string[] | null> {
  try {
    return parseFacts(await completeExtraction(value));
  } catch (err) {
    warnUnreachable(source, err);

    return null;
  }
}

// One extraction call, retried. Returns the raw text — parsing is the caller's, because a model that answered unparseably is a different problem from one that could not be reached.
async function completeExtraction(value: string): Promise<string> {
  const llm = Llm.instance;

  return withRetry(() =>
    llm
      .complete({
        systemPrompt: EXTRACTION_PROMPT,
        prompt: value,
        jobName: "fact-extraction",
      })
      .then((r) => r.text),
  );
}

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

// The model could not be reached. Named by source so the log says which write lost its facts — the write itself already succeeded either way.
function warnUnreachable(source: "memory" | "episode", err: unknown): void {
  console.warn(
    source === "memory"
      ? "[facts] LLM unreachable after 3 attempts, skipping fact extraction:"
      : "[facts] LLM unreachable for episode extraction:",
    err,
  );
}

/** Inserts each fact and lets it invalidate what it contradicts, returning how many older facts it retired. One bad fact is skipped, never the batch. */
async function storeFacts(
  pool: PgPool,
  facts: string[],
  agentId: string | null,
  insert: FactInsert,
): Promise<number> {
  let invalidated = 0;

  for (const factText of facts) {
    invalidated += await storeSingleFact(pool, factText, agentId, insert);
  }

  return invalidated;
}

async function storeSingleFact(
  pool: PgPool,
  factText: string,
  agentId: string | null,
  insert: FactInsert,
): Promise<number> {
  try {
    return await insertAndContradict(pool, factText, agentId, insert);
  } catch (err) {
    console.warn(
      `[facts] Failed to insert fact "${factText.substring(0, 50)}...":`,
      err,
    );

    return 0;
  }
}

/** Inserts one fact and lets it invalidate what it contradicts, returning how many older facts it retired. A failure here is logged and swallowed — one bad fact must not sink the batch. */
// Inserts one fact and lets it retire what it disagrees with. Contradiction detection needs the EMBEDDING, so a fact stored without one is still written — it just cannot contradict anything, and returns zero rather than being treated as a failure.
async function insertAndContradict(
  pool: PgPool,
  factText: string,
  agentId: string | null,
  insert: FactInsert,
): Promise<number> {
  const embeddingStr = toEmbeddingStr(await getQueryEmbedding(factText));
  const { rows } = await insert(factText, embeddingStr);
  const factId = embeddingStr ? rows[0]?.id : undefined;

  if (!factId) {
    return 0;
  }

  return invalidateContradictions(
    pool,
    factId as string,
    embeddingStr as string,
    agentId,
  );
}

function toEmbeddingStr(embedding: number[] | null): string | null {
  return embedding ? `[${embedding.join(",")}]` : null;
}

function invalidatedNote(count: number): string {
  return count > 0 ? `, invalidated ${count} stale facts` : "";
}

// Extract facts from an episode (same pipeline, different source column).
export async function extractFactsFromEpisode(
  episodeId: string,
  content: string,
  agentId: string,
  pool: PgPool,
): Promise<void> {
  try {
    const facts = await extractFactTexts(content, "episode");

    if (!facts || facts.length === 0) {
      return;
    }
    await storeAndReport(pool, facts, {
      agentId,
      insert: episodeFactInsert(pool, episodeId),
      subject: `episode ${episodeId}`,
    });
  } catch (err) {
    console.warn("[facts] Unexpected error during episode extraction:", err);
  }
}

// Inserts one extracted fact against its episode. No `confidence` column here — the default is `observed`, because an episode is raw text something actually did or said rather than a conclusion an agent drew.
function episodeFactInsert(pool: PgPool, episodeId: string): FactInsert {
  return (factText, embedding) =>
    pool.query(
      `INSERT INTO memory.facts (episode_id, fact_text, embedding, valid_from)
         VALUES ($1, $2, $3, now())
         RETURNING id`,
      [episodeId, factText, embedding],
    );
}
