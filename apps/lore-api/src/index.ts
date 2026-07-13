import { initOtel } from "./platform/otel-init.js";
import pg from "pg";
import { setPool } from "@re-cinq/lore-server-core/platform/db.js";
import { setMemoryPool } from "@re-cinq/lore-server-core/features/memory/memory.js";
import { setPipelinePool } from "@re-cinq/lore-server-core/features/pipeline/pipeline.js";
import { Llm } from "@re-cinq/lore-shared";
import { loadTaskTypes } from "@re-cinq/lore-server-core/features/pipeline/pipeline-config.js";
import { loadDefaultTemplates } from "@re-cinq/lore-server-core/features/context/context-assembly.js";
import { startHttpServer } from "./server/http-server.js";

// Shared mutable state: the DB pool is created in main() and read lazily by the
// route handlers via getPool() (they fail soft with 503 when it is null).
const state: { pool: any } = { pool: null };
const getPool = () => state.pool;

async function main() {
  await initOtel();

  const dbHost = process.env.LORE_DB_HOST;
  if (dbHost) {
    const dbPool = new pg.Pool({
      host: dbHost,
      port: parseInt(process.env.LORE_DB_PORT || "5432", 10),
      database: process.env.LORE_DB_NAME || "lore",
      user: process.env.LORE_DB_USER || "postgres",
      password: process.env.LORE_DB_PASSWORD,
    });
    setPool(dbPool);
    setMemoryPool(dbPool);
    setPipelinePool(dbPool);
    Llm.configure({ costPool: dbPool });
    state.pool = dbPool;
    console.error(`[lore-api] Database mode: PostgreSQL at ${dbHost}`);
  } else {
    console.error(
      "[lore-api] Database mode: none (LORE_DB_HOST not set) — routes fail soft with 503",
    );
  }

  loadTaskTypes();
  loadDefaultTemplates();

  await startHttpServer(getPool);
}

main().catch((err) => {
  console.error("Fatal:", err);
  process.exit(1);
});
