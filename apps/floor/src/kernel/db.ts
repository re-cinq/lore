import pg from "pg";
import { enforceTrue } from "@re-cinq/lore-shared/lib/enforce.js";

let pool: pg.Pool | null = null;

export function initPool(): pg.Pool {
  pool = new pg.Pool({
    host: process.env.LORE_DB_HOST || "localhost",
    port: parseInt(process.env.LORE_DB_PORT || "5432", 10),
    database: process.env.LORE_DB_NAME || "lore",
    user: process.env.LORE_DB_USER || "postgres",
    password: process.env.LORE_DB_PASSWORD,
    max: 5,
  });

  return pool;
}

export function getPool(): pg.Pool {
  enforceTrue(pool, "DB pool not initialized — call initPool() first");

  return pool;
}

export async function query<T = Record<string, unknown>>(
  text: string,
  params?: unknown[],
): Promise<T[]> {
  const { rows } = await getPool().query(text, params);

  return rows as T[];
}

export async function queryOne<T = Record<string, unknown>>(
  text: string,
  params?: unknown[],
): Promise<T | null> {
  const rows = await query<T>(text, params);

  return rows[0] || null;
}

export async function isDbAvailable(): Promise<boolean> {
  try {
    await getPool().query("SELECT 1");

    return true;
  } catch {
    return false;
  }
}
