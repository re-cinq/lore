import { initOtel } from "./platform/otel.js";
import { join } from "node:path";
import pg from "pg";
import { setPool } from "./platform/db.js";
import { setMemoryPool } from "./features/memory/memory.js";
import { setPipelinePool } from "./features/pipeline/pipeline.js";
import { Llm } from "@re-cinq/lore-shared";
import { loadTaskTypes } from "./features/pipeline/pipeline-config.js";
import { loadTemplates } from "./features/context/context-assembly.js";

/**
 * Shared startup for both server entrypoints. Initializes OTel, creates the
 * Postgres pool when LORE_DB_HOST is set (the remote server; the local stdio
 * adapter runs pool-less and proxies to it), and loads task-type config and
 * context templates. Returns a getter for the pool (null in pool-less mode).
 */
export async function boot(): Promise<() => pg.Pool | null> {
  await initOtel();

  let pool: pg.Pool | null = null;
  if (process.env.LORE_DB_HOST) {
    pool = new pg.Pool({
      host: process.env.LORE_DB_HOST,
      port: parseInt(process.env.LORE_DB_PORT || "5432", 10),
      database: process.env.LORE_DB_NAME || "lore",
      user: process.env.LORE_DB_USER || "postgres",
      password: process.env.LORE_DB_PASSWORD,
    });
    setPool(pool);
    setMemoryPool(pool);
    setPipelinePool(pool);
    Llm.configure({ costPool: pool });
    console.error(`[lore] Database mode: PostgreSQL at ${process.env.LORE_DB_HOST}`);
  } else {
    console.error("[lore] Database mode: local files (LORE_DB_HOST not set)");
  }

  loadTaskTypes();
  loadTemplates(join(import.meta.dirname, "..", "templates"));

  return () => pool;
}
