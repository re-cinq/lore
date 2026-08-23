// The stations service's Postgres pool.
//
// A station holds a pool ON PURPOSE — that is the whole point of the
// service-endpoint form (ADR-024). A pod station has none and pays for it with
// an HTTP seam per method it needs; a station that sits next to the data just
// asks the data. Everything here reaches Postgres through the shared ports, not
// a `query()` escape hatch, so there is deliberately no such helper.

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

  pool.on("error", (err) => {
    console.error("[db] pg pool error (idle client):", err);
  });

  return pool;
}

export function getPool(): pg.Pool {
  enforceTrue(pool, Error, "DB pool not initialized — call initPool() first");

  return pool;
}

/** Whether Postgres answers — the readiness probe's whole question. */
export async function isDbAvailable(): Promise<boolean> {
  try {
    await getPool().query("SELECT 1");

    return true;
  } catch {
    return false;
  }
}
