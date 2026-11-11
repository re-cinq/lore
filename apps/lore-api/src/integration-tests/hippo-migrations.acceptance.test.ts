import { describe, it, expect, beforeAll, afterAll } from "vitest";
import pg from "pg";
import { readFileSync } from "node:fs";
import { join } from "node:path";

const MIGRATOR_USER = "lore_hippo_test_migrator";
const MIGRATOR_PASSWORD = "hippo_migrator_test";

const REQUIRED_HIPPO_SCHEMA = {
  factsColumns: [
    "confidence",
    "half_life_days",
    "last_retrieved_at",
    "retrieval_count",
  ],
  memoriesColumns: ["half_life_days", "last_retrieved_at", "retrieval_count"],
  confidenceCheckTiers: ["inferred", "observed", "stale", "verified"],
  tables: ["memory.fact_conflicts", "pipeline.audit_log"],
};

describe("hippo-memory and audit_log migrations (T010)", () => {
  let superuserPool: pg.Pool;

  beforeAll(async () => {
    superuserPool = makeSuperuserPool("postgres");
  });

  afterAll(async () => {
    if (superuserPool) {
      await superuserPool.end();
    }
  });

  it("applies migration sequence twice on a legacy (partially migrated) database and leaves the required schema", async () => {
    const dbName = "lore_test_legacy_hippo";

    await setupSuperuserDb(dbName, superuserPool);
    await setupLegacyPartiallyMigratedSchema(dbName, superuserPool);
    await runMigrations(dbName);

    expect(await readHippoSchemaState(dbName)).toEqual(REQUIRED_HIPPO_SCHEMA);
  });

  it("applies migration sequence twice on an empty database and leaves the required schema", async () => {
    const dbName = "lore_test_empty_hippo";

    await setupSuperuserDb(dbName, superuserPool);
    await setupEmptyBootstrapSchema(dbName, superuserPool);
    await runMigrations(dbName);

    expect(await readHippoSchemaState(dbName)).toEqual(REQUIRED_HIPPO_SCHEMA);
  });

  it("distinguishes a non-owner privilege skip on memory tables from a converged schema until ownership is reconciled", async () => {
    const dbName = "lore_test_privilege_skip_hippo";

    await setupSuperuserDb(dbName, superuserPool);
    await setupPrivilegeGuardedSchema(dbName, superuserPool);
    await runMigrations(dbName, MIGRATOR_USER, MIGRATOR_PASSWORD);

    expect(await readHippoSchemaState(dbName)).toEqual({
      factsColumns: [],
      memoriesColumns: [],
      confidenceCheckTiers: [],
      tables: ["pipeline.audit_log"],
    });

    await reconcileMemoryOwnership(dbName);
    await runMigrations(dbName, MIGRATOR_USER, MIGRATOR_PASSWORD);

    expect(await readHippoSchemaState(dbName)).toEqual(REQUIRED_HIPPO_SCHEMA);
  });
});

async function setupSuperuserDb(
  dbName: string,
  superuserPool: pg.Pool,
): Promise<void> {
  await superuserPool.query(`DROP DATABASE IF EXISTS ${dbName}`);
  await superuserPool.query(`CREATE DATABASE ${dbName}`);
}

const APP_USER = process.env.LORE_DB_USER || "lore";
const APP_PASSWORD = process.env.LORE_DB_PASSWORD || "lore";

async function setupLegacyPartiallyMigratedSchema(
  dbName: string,
  superuserPool: pg.Pool,
): Promise<void> {
  await ensureAppRoleAndGrantCreate(dbName, superuserPool);
  const lorePool = makeUserPool(dbName, APP_USER, APP_PASSWORD);

  try {
    await lorePool.query(`
      CREATE SCHEMA IF NOT EXISTS memory;
      CREATE TABLE IF NOT EXISTS memory.memories (
        id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        agent_id TEXT NOT NULL,
        key TEXT NOT NULL,
        value TEXT NOT NULL,
        version INTEGER NOT NULL DEFAULT 1,
        is_deleted BOOLEAN NOT NULL DEFAULT FALSE,
        created_at TIMESTAMPTZ NOT NULL DEFAULT now()
      );
      CREATE TABLE IF NOT EXISTS memory.facts (
        id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        memory_id UUID REFERENCES memory.memories(id),
        fact_text TEXT NOT NULL,
        retrieval_count INT DEFAULT 0,
        created_at TIMESTAMPTZ NOT NULL DEFAULT now()
      );
      CREATE SCHEMA IF NOT EXISTS pipeline;
    `);
  } finally {
    await lorePool.end();
  }
}

async function setupEmptyBootstrapSchema(
  dbName: string,
  superuserPool: pg.Pool,
): Promise<void> {
  await ensureAppRoleAndGrantCreate(dbName, superuserPool);
  const lorePool = makeUserPool(dbName, APP_USER, APP_PASSWORD);

  try {
    await lorePool.query(`
      CREATE SCHEMA memory;
      CREATE TABLE memory.memories (
        id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        agent_id TEXT NOT NULL,
        key TEXT NOT NULL,
        value TEXT NOT NULL,
        version INTEGER NOT NULL DEFAULT 1,
        is_deleted BOOLEAN NOT NULL DEFAULT FALSE,
        created_at TIMESTAMPTZ NOT NULL DEFAULT now()
      );
      CREATE TABLE memory.facts (
        id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        memory_id UUID REFERENCES memory.memories(id),
        fact_text TEXT NOT NULL,
        created_at TIMESTAMPTZ NOT NULL DEFAULT now()
      );
      CREATE SCHEMA pipeline;
    `);
  } finally {
    await lorePool.end();
  }
}

async function ensureAppRoleAndGrantCreate(
  dbName: string,
  superuserPool: pg.Pool,
): Promise<void> {
  await superuserPool.query(`
    DO $$ BEGIN
      IF NOT EXISTS (SELECT FROM pg_roles WHERE rolname = '${APP_USER}') THEN
        CREATE ROLE ${APP_USER} LOGIN PASSWORD '${APP_PASSWORD}';
      ELSE
        ALTER ROLE ${APP_USER} LOGIN PASSWORD '${APP_PASSWORD}';
      END IF;
    END $$;
  `);
  await superuserPool.query(
    `GRANT CREATE ON DATABASE "${dbName}" TO ${APP_USER}`,
  );
}

async function setupPrivilegeGuardedSchema(
  dbName: string,
  superuserPool: pg.Pool,
): Promise<void> {
  await superuserPool.query(`
    DO $$ BEGIN
      IF NOT EXISTS (SELECT FROM pg_roles WHERE rolname = '${MIGRATOR_USER}') THEN
        CREATE ROLE ${MIGRATOR_USER} NOSUPERUSER LOGIN PASSWORD '${MIGRATOR_PASSWORD}';
      ELSE
        ALTER ROLE ${MIGRATOR_USER} NOSUPERUSER LOGIN PASSWORD '${MIGRATOR_PASSWORD}';
      END IF;
    END $$;
  `);

  const pool = makeSuperuserPool(dbName);

  try {
    await pool.query(`
      CREATE SCHEMA IF NOT EXISTS memory;
      CREATE TABLE IF NOT EXISTS memory.memories (
        id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        agent_id TEXT NOT NULL,
        key TEXT NOT NULL,
        value TEXT NOT NULL,
        version INTEGER NOT NULL DEFAULT 1,
        is_deleted BOOLEAN NOT NULL DEFAULT FALSE,
        created_at TIMESTAMPTZ NOT NULL DEFAULT now()
      );
      CREATE TABLE IF NOT EXISTS memory.facts (
        id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        memory_id UUID REFERENCES memory.memories(id),
        fact_text TEXT NOT NULL,
        created_at TIMESTAMPTZ NOT NULL DEFAULT now()
      );

      CREATE SCHEMA IF NOT EXISTS pipeline;

      GRANT USAGE ON SCHEMA memory TO ${MIGRATOR_USER};
      GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA memory TO ${MIGRATOR_USER};
      GRANT USAGE, CREATE ON SCHEMA pipeline TO ${MIGRATOR_USER};
    `);
  } finally {
    await pool.end();
  }
}

async function reconcileMemoryOwnership(dbName: string): Promise<void> {
  const pool = makeSuperuserPool(dbName);

  try {
    await pool.query(`
      GRANT CREATE ON SCHEMA memory TO ${MIGRATOR_USER};
      ALTER TABLE memory.memories OWNER TO ${MIGRATOR_USER};
      ALTER TABLE memory.facts OWNER TO ${MIGRATOR_USER};
    `);
  } finally {
    await pool.end();
  }
}

const MIGRATIONS_DIR = join(
  import.meta.dirname,
  "..",
  "..",
  "..",
  "..",
  "deploy",
  "chart",
  "charts",
  "ui-helm",
  "migrations",
);

async function runMigrations(
  dbName: string,
  user = APP_USER,
  password = APP_PASSWORD,
): Promise<void> {
  const lorePool = makeUserPool(dbName, user, password);
  const mig13 = readFileSync(
    join(MIGRATIONS_DIR, "0013_memory_hippo_columns.sql"),
    "utf-8",
  );
  const mig14 = readFileSync(
    join(MIGRATIONS_DIR, "0014_dark_factory_audit_log.sql"),
    "utf-8",
  );

  try {
    await lorePool.query(mig13);
    await lorePool.query(mig14);
    await lorePool.query(mig13);
    await lorePool.query(mig14);
  } finally {
    await lorePool.end();
  }
}

async function readHippoSchemaState(dbName: string) {
  const verifyPool = makeSuperuserPool(dbName);

  try {
    const factsRes = await verifyPool.query(`
      SELECT column_name
      FROM information_schema.columns
      WHERE table_schema = 'memory'
        AND table_name = 'facts'
        AND column_name IN ('confidence', 'retrieval_count', 'last_retrieved_at', 'half_life_days')
      ORDER BY column_name
    `);
    const memoriesRes = await verifyPool.query(`
      SELECT column_name
      FROM information_schema.columns
      WHERE table_schema = 'memory'
        AND table_name = 'memories'
        AND column_name IN ('retrieval_count', 'last_retrieved_at', 'half_life_days')
      ORDER BY column_name
    `);
    const checkRes = await verifyPool.query(`
      SELECT pg_get_constraintdef(c.oid) AS def
      FROM pg_constraint c
      JOIN pg_class t ON t.oid = c.conrelid
      JOIN pg_namespace n ON n.oid = t.relnamespace
      WHERE n.nspname = 'memory'
        AND t.relname = 'facts'
        AND c.conname = 'facts_confidence_check'
    `);
    const tablesRes = await verifyPool.query(`
      SELECT table_schema || '.' || table_name AS full_name
      FROM information_schema.tables
      WHERE (table_schema = 'memory' AND table_name = 'fact_conflicts')
         OR (table_schema = 'pipeline' AND table_name = 'audit_log')
      ORDER BY full_name
    `);
    const constraintDef = String(checkRes.rows[0]?.def ?? "");

    return {
      factsColumns: factsRes.rows.map((row) => String(row.column_name)),
      memoriesColumns: memoriesRes.rows.map((row) => String(row.column_name)),
      confidenceCheckTiers: [
        "inferred",
        "observed",
        "stale",
        "verified",
      ].filter((tier) => constraintDef.includes(`'${tier}'`)),
      tables: tablesRes.rows.map((row) => String(row.full_name)),
    };
  } finally {
    await verifyPool.end();
  }
}

function makeSuperuserPool(database: string): pg.Pool {
  return makeUserPool(
    database,
    process.env.LORE_DB_SUPERUSER || "postgres",
    process.env.LORE_DB_PASSWORD || "lore",
  );
}

function makeUserPool(
  database: string,
  user: string,
  password: string,
): pg.Pool {
  return new pg.Pool({
    host: process.env.LORE_DB_HOST || "localhost",
    port: parseInt(process.env.LORE_DB_PORT || "5432"),
    database,
    user,
    password,
  });
}
