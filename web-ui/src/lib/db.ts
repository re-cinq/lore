import { Pool } from 'pg';

const pool = new Pool({
  host: process.env.LORE_DB_HOST || 'localhost',
  port: parseInt(process.env.LORE_DB_PORT || '5432'),
  database: process.env.LORE_DB_NAME || 'lore',
  user: process.env.LORE_DB_USER || 'lore_ui',
  password: process.env.LORE_DB_PASSWORD,
  max: 10,
});

export async function query<T = any>(text: string, params?: any[]): Promise<T[]> {
  const { rows } = await pool.query(text, params);
  return rows as T[];
}

export async function queryOne<T = any>(text: string, params?: any[]): Promise<T | null> {
  const rows = await query<T>(text, params);
  return rows[0] || null;
}

const SCHEMA_RE = /^[a-z][a-z0-9_]{0,62}$/;

/** Returns all schemas that contain a chunks table (team schemas + org_shared). */
export async function getChunkSchemas(): Promise<string[]> {
  const { rows } = await pool.query(
    `SELECT DISTINCT team FROM lore.repos WHERE team IS NOT NULL AND team ~ '^[a-z][a-z0-9_]{0,62}$'`
  );
  const schemas = rows.map((r: any) => r.team as string).filter((s: string) => SCHEMA_RE.test(s));
  if (!schemas.includes('org_shared')) schemas.push('org_shared');
  return schemas;
}

/** Resolve the chunk schema for a given repo (team schema or org_shared fallback). */
export async function getRepoSchema(fullName: string): Promise<string> {
  const row = await queryOne<{ team: string | null }>(`SELECT team FROM lore.repos WHERE full_name = $1`, [fullName]);
  const team = row?.team ?? '';
  return SCHEMA_RE.test(team) ? team : 'org_shared';
}

/**
 * Build a UNION ALL across all chunk schemas.
 * `selectFn` receives a schema name and returns the SELECT statement for that schema.
 * Caller is responsible for safe schema interpolation (schemas are validated against SCHEMA_RE).
 */
export async function queryAllChunks<T = any>(
  selectFn: (schema: string, paramOffset: number) => { sql: string; params: any[] },
  baseParams: any[] = [],
): Promise<T[]> {
  const schemas = await getChunkSchemas();
  const parts: string[] = [];
  const allParams: any[] = [...baseParams];
  for (const schema of schemas) {
    const { sql, params } = selectFn(schema, allParams.length + 1);
    parts.push(sql);
    allParams.push(...params);
  }
  if (parts.length === 0) return [];
  const unionSql = parts.join(' UNION ALL ');
  const { rows } = await pool.query(unionSql, allParams);
  return rows as T[];
}
