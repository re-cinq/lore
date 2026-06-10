import { initOtel } from "./platform/otel.js";
import { join } from "node:path";
import pg from "pg";
import { setPool } from "./platform/db.js";
import { setMemoryPool } from "./features/memory/memory.js";
import { setPipelinePool } from "./features/pipeline/pipeline.js";
import { Llm } from "@re-cinq/lore-shared";
import { loadTaskTypes } from "./features/pipeline/pipeline-config.js";
import { loadTemplates } from "./features/context/context-assembly.js";
import { buildMcpServer } from "./server/build-mcp-server.js";
import { startTransport } from "./server/transports.js";

// Shared mutable state: the DB pool is created in main() AFTER the server
// is built, so tools and route handlers read it lazily via getPool().
const state: { pool: any } = { pool: null };
const getPool = () => state.pool;

const server = buildMcpServer({ getPool });

async function main() {
  await initOtel();

  // Initialize PostgreSQL connection pool if LORE_DB_HOST is set
  if (process.env.LORE_DB_HOST) {
    const dbHost = process.env.LORE_DB_HOST;
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
    console.error(`[lore] Database mode: PostgreSQL at ${dbHost}`);
  } else {
    console.error("[lore] Database mode: local files (LORE_DB_HOST not set)");
  }

  // Initialize pipeline config and context assembly templates. The engine now
  // lives in @re-cinq/lore-shared, so the mcp templates dir is passed explicitly
  // (the shared default would resolve into the shared package tree).
  loadTaskTypes();
  loadTemplates(join(import.meta.dirname, "..", "templates"));
  if (process.env.LORE_DB_HOST) {
    console.error('[lore] Pipeline task CRUD ready (processing handled by lore-agent)');
  }

  await startTransport(server, getPool);
}

main().catch((err) => {
  console.error("Fatal:", err);
  process.exit(1);
});
