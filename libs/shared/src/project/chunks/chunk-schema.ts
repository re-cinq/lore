import type { PgPool } from "../../memory-store.js";

// Chunk-schema resolution, single-sourced for every repo-scoped reader — must mirror reindex's write target (team schema or org_shared) or team-schema repos read empty/stale (#967, #975). Only regex-gated names ever leave this module (string-interpolated into table names).

export const ORG_SHARED_SCHEMA = "org_shared";

const SCHEMA_RE = /^[a-z][a-z0-9_]+$/;
const CACHE_TTL_MS = 60_000;

interface CacheEntry {
  promise: Promise<string>;
  expires: number;
}

const cacheByPool = new WeakMap<PgPool, Map<string, CacheEntry>>();

function cacheFor(pool: PgPool): Map<string, CacheEntry> {
  const existing = cacheByPool.get(pool);

  if (existing) {
    return existing;
  }
  const created = new Map<string, CacheEntry>();

  cacheByPool.set(pool, created);

  return created;
}

/** candidate when it's a regex-safe name for a schema that actually holds a chunks table, else org_shared — schema existence alone isn't enough (public/lore/pipeline exist but have no chunks table). */
export async function chunkSchemaOrOrgShared(
  pool: PgPool,
  candidate: string | null | undefined,
): Promise<string> {
  if (!candidate || !SCHEMA_RE.test(candidate)) {
    return ORG_SHARED_SCHEMA;
  }

  if (candidate === ORG_SHARED_SCHEMA) {
    return ORG_SHARED_SCHEMA;
  }
  const { rows } = await pool.query(
    `SELECT table_schema FROM information_schema.tables WHERE table_schema = $1 AND table_name = 'chunks'`,
    [candidate],
  );

  return rows.length > 0 ? candidate : ORG_SHARED_SCHEMA;
}

async function lookupSchemaForRepo(
  pool: PgPool,
  repo: string,
): Promise<string> {
  const { rows } = await pool.query(
    "SELECT team FROM lore.repos WHERE full_name = $1",
    [repo],
  );

  return chunkSchemaOrOrgShared(pool, rows[0]?.team as string | undefined);
}

/** The schema reindex wrote this repo's chunks to (team schema or org_shared, mirroring resolveSchema); memoized per pool for 60s since context assembly resolves the same repo from several sources in parallel. Failed lookups are never cached. */
export function resolveChunkSchemaForRepo(
  pool: PgPool,
  repo: string,
): Promise<string> {
  const cache = cacheFor(pool);
  const cached = cache.get(repo);

  if (cached && cached.expires > Date.now()) {
    return cached.promise;
  }
  const promise = lookupSchemaForRepo(pool, repo);

  cache.set(repo, { promise, expires: Date.now() + CACHE_TTL_MS });
  promise.catch(() => cache.delete(repo));

  return promise;
}

/** Every provisioned schema holding a chunks table (regex-gated), always including org_shared — the enumeration cross-repo readers UNION over. */
export async function listChunkSchemas(pool: PgPool): Promise<string[]> {
  const { rows } = await pool.query(
    `SELECT table_schema FROM information_schema.tables WHERE table_name = 'chunks'`,
  );
  const schemas = rows
    .map((row) => row.table_schema as string)
    .filter((schema) => SCHEMA_RE.test(schema));

  return schemas.includes(ORG_SHARED_SCHEMA)
    ? schemas
    : [...schemas, ORG_SHARED_SCHEMA];
}
