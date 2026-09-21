import type { Pool } from "pg";
import { initOtel } from "./outbound/otel-init.js";
import pg from "pg";
import { setPool } from "@re-cinq/lore-server-core/platform/db.js";
import { setMemoryPool } from "@re-cinq/lore-server-core/features/memory/memory.js";
import { setPipelinePool } from "@re-cinq/lore-server-core/features/pipeline/pipeline.js";
import { Llm } from "@re-cinq/lore-shared";
import { PgUsage } from "@re-cinq/lore-shared/project/usage/usage-pg.js";
import { loadTaskTypes } from "@re-cinq/lore-server-core/features/pipeline/pipeline-config.js";
import { loadDefaultTemplates } from "@re-cinq/lore-server-core/features/context/context-assembly.js";
import { startHttpServer } from "./app/http-server.js";
import { dbConfigFromEnv } from "@re-cinq/lore-shared/db/pg-pool.js";
import { loadAgentDefaults } from "@re-cinq/lore-shared/project/agents/agent-defaults-files.js";
import { seedAgentDefaults } from "@re-cinq/lore-shared/project/agents/agent-defaults-seed.js";

// Shared mutable state: the DB pool is created in main() and read lazily by route handlers via getPool().
const state: { pool: Pool | null } = { pool: null };
const getPool = () => state.pool;

async function main() {
  await initOtel();

  const dbHost = process.env.LORE_DB_HOST;

  if (!dbHost) {
    console.error(
      "[lore-api] Database mode: none (LORE_DB_HOST not set) — routes fail soft with 503",
    );
  }

  state.pool = dbHost ? connectDatabase(dbHost) : null;

  loadTaskTypes();
  loadDefaultTemplates();

  if (state.pool) {
    await seedShippedAgents(state.pool);
  }

  await startHttpServer(getPool);
}

/** One pool reaches four consumers: the three server-core module singletons plus the LLM usage sink. */
function connectDatabase(dbHost: string): Pool {
  const dbPool = createPool();

  setPool(dbPool);
  setMemoryPool(dbPool);
  setPipelinePool(dbPool);
  Llm.configure({ usage: new PgUsage(dbPool) });
  console.error(`[lore-api] Database mode: PostgreSQL at ${dbHost}`);

  return dbPool;
}

// Before the server listens, so a rollout's new pod has seeded before it serves. A failed seed must not stop the deploy: the rows already in the table are the previous release's, and still valid.
async function seedShippedAgents(pool: Pool): Promise<void> {
  try {
    const seeded = await seedAgentDefaults(pool, loadAgentDefaults());
    const diverged =
      seeded.diverged.length > 0
        ? `; differing from the shipped default: ${seeded.diverged.join(", ")}`
        : "";

    console.error(
      `[lore-api] agent defaults seeded: ${seeded.inserted.length} inserted, ${seeded.updated.length} updated${diverged}`,
    );
  } catch (err) {
    console.error(
      "[lore-api] agent defaults seed FAILED — serving the rows already in lore.agent_definitions:",
      err,
    );
  }
}

function createPool(): Pool {
  const dbPool = new pg.Pool(dbConfigFromEnv());

  // An idle client's error surfaces on the pool rather than a query, and unhandled it takes the process down.
  dbPool.on("error", (err) => {
    console.error("[lore-api] pg pool error (idle client):", err);
  });

  return dbPool;
}

main().catch((err) => {
  console.error("Fatal:", err);
  process.exit(1);
});
