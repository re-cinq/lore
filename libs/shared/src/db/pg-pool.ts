/** Shared Postgres pool builder (dedupes 3 byte-identical copies across floor/event-router/stations); `getPool` throws until `initPool` has run, so repository singletons can stay lazy and still fail loudly. */

import pg from "pg";
import { enforceTrue } from "../lib/enforce.js";

let pool: pg.Pool | null = null;

export function initPool(env: NodeJS.ProcessEnv = process.env): pg.Pool {
  pool = new pg.Pool({
    host: env.LORE_DB_HOST || "localhost",
    port: parseInt(env.LORE_DB_PORT || "5432", 10),
    database: env.LORE_DB_NAME || "lore",
    user: env.LORE_DB_USER || "postgres",
    password: env.LORE_DB_PASSWORD,
    max: 5,
  });

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
