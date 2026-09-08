import type { Pool } from "pg";
import {
  SCHEMA_RE,
  ORG_SHARED_SCHEMA,
  pickSchema,
} from "../../../work/chunks/repo-schema.js";
import { memoizeWithTtl } from "../../../work/chunks/ttl-memo.js";

/** Which schemas the context browser may read chunks from (ADR-032) — per-team schemas plus org_shared, resolved once per TTL rather than per request. */

const SCHEMA_CATALOG_TTL_MS = 30_000;

/** Schemas that actually HAVE a chunks table. The name pattern is enforced in SQL and again in code because these names are interpolated into later queries — a schema list is the one place this API builds SQL from data. */
async function readProvisionedSchemas(pool: Pool): Promise<string[]> {
  const { rows } = await pool.query(
    `SELECT table_schema FROM information_schema.tables
        WHERE table_name = 'chunks' AND table_schema ~ '^[a-z][a-z0-9_]{0,62}$'`,
  );

  return rows
    .map((r) => r.table_schema as string)
    .filter((s: string) => SCHEMA_RE.test(s));
}

/** Team schemas some repo actually references, intersected with the ones provisioned — a team named on a repo whose schema was never created would otherwise put a missing relation into the union. `org_shared` is always included: it holds context that belongs to no single team. */
async function readReferencedSchemas(
  pool: Pool,
  provisioned: () => Promise<string[]>,
): Promise<string[]> {
  const { rows } = await pool.query(
    `SELECT DISTINCT team FROM lore.repos WHERE team IS NOT NULL AND team ~ '^[a-z][a-z0-9_]{0,62}$'`,
  );
  const existing = new Set(await provisioned());
  const schemas = rows
    .map((r) => r.team as string)
    .filter((s: string) => SCHEMA_RE.test(s) && existing.has(s));

  if (!schemas.includes(ORG_SHARED_SCHEMA)) {
    schemas.push(ORG_SHARED_SCHEMA);
  }

  return schemas;
}

/** The two schema questions a browse read asks: every schema in scope, and the one schema a named repo lives in. */
export function schemaReaders(pool: Pool) {
  const listChunkSchemas = memoizeWithTtl(
    () => readProvisionedSchemas(pool),
    SCHEMA_CATALOG_TTL_MS,
  );
  /** Referenced, provisioned team schemas + org_shared. */
  const getChunkSchemas = memoizeWithTtl(
    () => readReferencedSchemas(pool, listChunkSchemas),
    SCHEMA_CATALOG_TTL_MS,
  );

  async function repoSchema(repo: string): Promise<string> {
    const { rows } = await pool.query<{ team: string | null }>(
      `SELECT team FROM lore.repos WHERE full_name = $1`,
      [repo],
    );

    return pickSchema(rows[0]?.team, await listChunkSchemas());
  }

  return { getChunkSchemas, repoSchema };
}
