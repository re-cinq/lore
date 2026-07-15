import { Pool } from "pg";
import { SCHEMA_RE, ORG_SHARED_SCHEMA, pickSchema } from "./repo-schema";

const pool = new Pool({
  host: process.env.LORE_DB_HOST || "localhost",
  port: parseInt(process.env.LORE_DB_PORT || "5432"),
  database: process.env.LORE_DB_NAME || "lore",
  user: process.env.LORE_DB_USER || "lore_ui",
  password: process.env.LORE_DB_PASSWORD,
  max: 10,
});

export async function query<T = Record<string, unknown>>(
  text: string,
  params?: unknown[],
): Promise<T[]> {
  const { rows } = await pool.query(text, params);

  return rows as T[];
}

export async function queryOne<T = Record<string, unknown>>(
  text: string,
  params?: unknown[],
): Promise<T | null> {
  const rows = await query<T>(text, params);

  return rows[0] || null;
}

export type QueryFn = <T = Record<string, unknown>>(
  text: string,
  params?: unknown[],
) => Promise<T[]>;

/**
 * Run `fn` inside a single BEGIN/COMMIT on one pooled connection, rolling back
 * on any failure. Only for write paths that genuinely need atomicity — e.g.
 * onboarding's task + repos-row pair, where a partial write leaves a zombie
 * repo or a duplicate-spawning retry.
 */
export async function withTransaction<T>(
  fn: (tx: QueryFn) => Promise<T>,
): Promise<T> {
  const client = await pool.connect();

  try {
    await client.query("BEGIN");
    const tx: QueryFn = async (text, params) =>
      (await client.query(text, params)).rows;
    const result = await fn(tx);

    await client.query("COMMIT");

    return result;
  } catch (err) {
    // Best-effort: the connection may already be dead, and that failure must
    // not mask the original error.
    await client.query("ROLLBACK").catch(() => undefined);
    throw err;
  } finally {
    client.release();
  }
}

/**
 * Like `query`, but returns `[]` when the relation does not exist (Postgres
 * 42P01) instead of throwing. For tables added by deploy-time migrations that
 * may be absent locally (local dev never runs the migrations dir) or during the
 * brief window before a deploy's migration hook completes — an empty result is
 * the correct degraded state, not a 500.
 */
export async function queryAllowMissing<T = Record<string, unknown>>(
  text: string,
  params?: unknown[],
): Promise<T[]> {
  try {
    return await query<T>(text, params);
  } catch (err) {
    if ((err as { code?: string }).code === "42P01") {
      console.warn(
        `[db] relation missing, returning empty: ${(err as Error).message}`,
      );

      return [];
    }
    throw err;
  }
}

/**
 * Schemas that actually have a `chunks` table, read from the catalog. This is
 * the source of truth for "does this team's schema exist" — `lore.repos.team`
 * is free-text and can name a schema that was never provisioned.
 */
export async function listChunkSchemas(): Promise<string[]> {
  const { rows } = await pool.query(
    `SELECT table_schema FROM information_schema.tables
      WHERE table_name = 'chunks' AND table_schema ~ '^[a-z][a-z0-9_]{0,62}$'`,
  );

  return rows
    .map((r) => r.table_schema as string)
    .filter((s: string) => SCHEMA_RE.test(s));
}

/** Returns all schemas to search for chunks (referenced, provisioned team schemas + org_shared). */
export async function getChunkSchemas(): Promise<string[]> {
  const { rows } = await pool.query(
    `SELECT DISTINCT team FROM lore.repos WHERE team IS NOT NULL AND team ~ '^[a-z][a-z0-9_]{0,62}$'`,
  );
  const existing = new Set(await listChunkSchemas());
  const schemas = rows
    .map((r) => r.team as string)
    .filter((s: string) => SCHEMA_RE.test(s) && existing.has(s));

  if (!schemas.includes(ORG_SHARED_SCHEMA)) {
    schemas.push(ORG_SHARED_SCHEMA);
  }

  return schemas;
}

/** Resolve the chunk schema for a given repo (provisioned team schema or org_shared fallback). */
export async function getRepoSchema(fullName: string): Promise<string> {
  const row = await queryOne<{ team: string | null }>(
    `SELECT team FROM lore.repos WHERE full_name = $1`,
    [fullName],
  );

  return pickSchema(row?.team, await listChunkSchemas());
}

/**
 * Resolve schema and team for a repo in one query.
 * Returns null if the repo does not exist in lore.repos.
 */
export async function getRepoSchemaAndTeam(
  fullName: string,
): Promise<{ schema: string; team: string } | null> {
  const row = await queryOne<{ team: string | null }>(
    `SELECT team FROM lore.repos WHERE full_name = $1`,
    [fullName],
  );

  if (row === null) {
    return null;
  }
  const team = row.team ?? "";
  const schema = pickSchema(team, await listChunkSchemas());

  return { schema, team };
}

/**
 * Build a UNION ALL across all chunk schemas.
 * `selectFn` receives a schema name and returns the SELECT statement for that schema.
 * Caller is responsible for safe schema interpolation (schemas are validated against SCHEMA_RE).
 */
export async function queryAllChunks<T = Record<string, unknown>>(
  selectFn: (
    schema: string,
    paramOffset: number,
  ) => { sql: string; params: unknown[] },
  baseParams: unknown[] = [],
): Promise<T[]> {
  const schemas = await getChunkSchemas();
  const parts: string[] = [];
  const allParams: unknown[] = [...baseParams];

  for (const schema of schemas) {
    const { sql, params } = selectFn(schema, allParams.length + 1);

    parts.push(sql);
    allParams.push(...params);
  }

  if (parts.length === 0) {
    return [];
  }
  const unionSql = parts.join(" UNION ALL ");
  const { rows } = await pool.query(unionSql, allParams);

  return rows as T[];
}
