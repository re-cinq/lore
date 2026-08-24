/**
 * The Postgres pool every Lore service that holds one builds the same way.
 *
 * Three byte-identical copies existed (floor, event-router, stations) — same
 * env vars, same defaults, same `max`, same idle-client error handler. A copy
 * per service is a place for one of them to drift onto a different database and
 * be discovered by the symptom rather than the diff.
 *
 * `initPool` is separate from `getPool` on purpose: `getPool` throws until boot
 * has run, which is what lets every repository singleton in a service be lazy
 * and still fail loudly if something reaches for data before the pool exists.
 */

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

  // An idle client that errors would otherwise take the process down with an
  // unhandled 'error' event.
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
