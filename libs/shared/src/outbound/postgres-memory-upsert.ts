// The versioned-upsert half of the Postgres memory store: the memories row, the memory_versions row that must accompany it, and the head lookup that decides which of the two writes happens.

import type { PgPool } from "../domain/memory-store-types.js";

export interface UpsertInput {
  key: string;
  value: string;
  agentId: string;
  ttl?: number;
  embedding?: number[];
  repo?: string;
}

interface StoredValueMeta {
  embedding: string | null;
  ttlSeconds: number | null;
}

interface UpsertOutcome {
  memoryId: string;
  version: number;
}

const UPDATE_MEMORY_SQL = `UPDATE memory.memories
     SET value = $1, version = $2, embedding = $3,
         ttl_seconds = $4, expires_at = now() + make_interval(secs => $5),
         created_at = now()
     WHERE id = $6`;

/** An existing key gets a new version in place: same row, incremented version, refreshed TTL window. */
async function bumpExistingMemory(
  db: Pick<PgPool, "query">,
  head: { version: number; id: string },
  input: UpsertInput,
  meta: StoredValueMeta,
): Promise<UpsertOutcome> {
  const version = head.version + 1;
  const { embedding, ttlSeconds } = meta;

  await db.query(UPDATE_MEMORY_SQL, [
    input.value,
    version,
    embedding,
    ttlSeconds,
    ttlSeconds,
    head.id,
  ]);

  return { memoryId: head.id, version };
}

const INSERT_MEMORY_SQL = `INSERT INTO memory.memories (agent_id, key, value, embedding, version, ttl_seconds, expires_at, repo)
     VALUES ($1, $2, $3, $4, 1, $5, now() + make_interval(secs => $6), $7)
     RETURNING id, created_at`;

async function insertNewMemory(
  db: Pick<PgPool, "query">,
  input: UpsertInput,
  meta: StoredValueMeta,
): Promise<UpsertOutcome> {
  const { embedding, ttlSeconds } = meta;
  const result = await db.query<{ id: string }>(INSERT_MEMORY_SQL, [
    input.agentId,
    input.key,
    input.value,
    embedding,
    ttlSeconds,
    ttlSeconds,
    input.repo || null,
  ]);
  const { rows } = result;

  return { memoryId: rows[0].id, version: 1 };
}

function findHeadSql(lookupField: string): string {
  return `SELECT id, version FROM memory.memories
     WHERE ${lookupField} = $1 AND key = $2 AND is_deleted = FALSE
     ORDER BY version DESC LIMIT 1`;
}

/** The live head version of this key, scoped by repo when the caller gave one and by agent otherwise. */
async function findMemoryHead(
  db: Pick<PgPool, "query">,
  input: UpsertInput,
): Promise<{ version: number; id: string } | undefined> {
  const lookupField = input.repo ? "repo" : "agent_id";
  const lookupValue = input.repo || input.agentId;
  const { rows } = await db.query<{ version: number; id: string }>(
    findHeadSql(lookupField),
    [lookupValue, input.key],
  );

  return rows[0];
}

const INSERT_VERSION = `INSERT INTO memory.memory_versions (memory_id, version, value, embedding)
     VALUES ($1, $2, $3, $4)`;

export async function upsertMemoryWithVersion(
  db: Pick<PgPool, "query">,
  input: UpsertInput,
): Promise<UpsertOutcome> {
  const embedding = input.embedding ? `[${input.embedding.join(",")}]` : null;
  const meta = { embedding, ttlSeconds: input.ttl || null };
  const head = await findMemoryHead(db, input);
  const { memoryId, version } = head
    ? await bumpExistingMemory(db, head, input, meta)
    : await insertNewMemory(db, input, meta);

  await db.query(INSERT_VERSION, [memoryId, version, input.value, embedding]);

  return { memoryId, version };
}
