/** Shared Postgres pool builder (dedupes 3 byte-identical copies across floor/event-router/stations); `getPool` throws until `initPool` has run, so repository singletons can stay lazy and still fail loudly. */

import pg from "pg";
import { enforceTrue } from "../../lib/enforce.js";
import { requiredEnv, requiredPort } from "../../lib/required-env.js";

let pool: pg.Pool | null = null;

export interface DbConfig {
  host: string;
  port: number;
  database: string;
  user: string;
  password: string | undefined;
}

/** Connection settings are deployment facts, never code defaults: every chart and `scripts/dev-local.sh` set all four, so a missing one is a broken deployment that must fail at boot instead of silently dialing localhost. */
export function dbConfigFromEnv(
  env: NodeJS.ProcessEnv = process.env,
): DbConfig {
  return {
    host: requiredEnv(env, "LORE_DB_HOST"),
    port: requiredPort(env, "LORE_DB_PORT"),
    database: requiredEnv(env, "LORE_DB_NAME"),
    user: requiredEnv(env, "LORE_DB_USER"),
    password: env.LORE_DB_PASSWORD,
  };
}

export function initPool(env: NodeJS.ProcessEnv = process.env): pg.Pool {
  pool = new pg.Pool({ ...dbConfigFromEnv(env), max: 5 });

  // Without this handler an idle client error takes the process down (unhandled 'error' event).
  pool.on("error", (err) => {
    console.error("[db] pg pool error (idle client):", err);
  });

  return pool;
}

export function getPool(): pg.Pool {
  enforceTrue(pool, Error, "DB pool not initialized — call initPool() first");

  return pool;
}

/** Whether Postgres answers — what a readiness probe actually asks. */
export async function isDbAvailable(): Promise<boolean> {
  try {
    await getPool().query("SELECT 1");

    return true;
  } catch {
    return false;
  }
}

/** Test seam: drop the pool so a fresh `initPool` can run. */
export function resetPool(): void {
  pool = null;
}
