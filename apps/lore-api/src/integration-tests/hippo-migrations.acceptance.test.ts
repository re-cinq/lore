import { describe, it, expect, beforeAll, afterAll } from "vitest";
import pg from "pg";
import { readFileSync } from "node:fs";
import { join } from "node:path";

const APP_USER = process.env.LORE_DB_USER || "lore";
const APP_PASSWORD = process.env.LORE_DB_PASSWORD || "lore";

const MIGRATOR_USER = "lore_hippo_test_migrator";
const MIGRATOR_PASSWORD = "hippo_migrator_test";

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

async function setupSuperuserDb(dbName: string, superuserPool: pg.Pool) {
  await superuserPool.query(`DROP DATABASE IF EXISTS ${dbName}`);
  await superuserPool.query(`CREATE DATABASE ${dbName}`);
}

async function setupLegacySchema(
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

  const lorePool = new pg.Pool({
    host: process.env.LORE_DB_HOST || "localhost",
    port: parseInt(process.env.LORE_DB_PORT || "5432"),
    database: dbName,
    user: APP_USER,
    password: APP_PASSWORD,
  });

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
        created_at TIMESTAMPTZ NOT NULL DEFAULT now()
      );
      CREATE SCHEMA IF NOT EXISTS pipeline;
    `);
  } finally {
    await lorePool.end();
  }
}

async function setupPrivilegeGuardedSchema(
  dbName: string,
  superuserPool: pg.Pool,
): Promise<void> {
  await superuserPool.query(`
    DO $$ BEGIN
      IF NOT EXISTS (SELECT FROM pg_roles WHERE rolname = '${MIGRATOR_USER}') THEN
        CREATE ROLE ${MIGRATOR_USER} LOGIN PASSWORD '${MIGRATOR_PASSWORD}';
      ELSE
        ALTER ROLE ${MIGRATOR_USER} NOSUPERUSER LOGIN PASSWORD '${MIGRATOR_PASSWORD}';
      END IF;
    END $$;
  `);

  const pool = new pg.Pool({
    host: process.env.LORE_DB_HOST || "localhost",
    port: parseInt(process.env.LORE_DB_PORT || "5432"),
    database: dbName,
    user: process.env.LORE_DB_SUPERUSER || "postgres",
    password: process.env.LORE_DB_PASSWORD || "lore",
  });

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

async function runMigrations(
  dbName: string,
  user = APP_USER,
  password = APP_PASSWORD,
) {
  const lorePool = new pg.Pool({
    host: process.env.LORE_DB_HOST || "localhost",
    port: parseInt(process.env.LORE_DB_PORT || "5432"),
    database: dbName,
    user,
    password,
  });
  const mig13 = readFileSync(
    join(MIGRATIONS_DIR, "0013_memory_hippo_columns.sql"),
    "utf-8",
  );
  const mig14 = readFileSync(
    join(MIGRATIONS_DIR, "0014_dark_factory_audit_log.sql"),
    "utf-8",
  );

  await lorePool.query(mig13);
  await lorePool.query(mig14);

  await lorePool.query(mig13);
  await lorePool.query(mig14);
  await lorePool.end();
}

describe("hippo-memory and audit_log migrations (T010)", () => {
  let superuserPool: pg.Pool;

  beforeAll(async () => {
    superuserPool = new pg.Pool({
      host: process.env.LORE_DB_HOST || "localhost",
      port: parseInt(process.env.LORE_DB_PORT || "5432"),
      database: "postgres",
      user: process.env.LORE_DB_SUPERUSER || "postgres",
      password: process.env.LORE_DB_PASSWORD || "lore",
    });
  });

  afterAll(async () => {
    if (superuserPool) {
      await superuserPool.end();
    }
  });

  it("applies migration sequence twice on a legacy (partially migrated) database and leaves the required schema", async () => {
    const dbName = "lore_test_legacy_hippo";

    await setupSuperuserDb(dbName, superuserPool);
    await setupLegacySchema(dbName, superuserPool);
    await runMigrations(dbName);

    const verifyPool = new pg.Pool({
      host: process.env.LORE_DB_HOST || "localhost",
      port: parseInt(process.env.LORE_DB_PORT || "5432"),
      database: dbName,
      user: process.env.LORE_DB_SUPERUSER || "postgres",
      password: process.env.LORE_DB_PASSWORD || "lore",
    });

    try {
      const columnsRes = await verifyPool.query(`
        SELECT column_name
        FROM information_schema.columns
        WHERE table_schema = 'memory' AND table_name = 'facts' AND column_name = 'confidence'
      `);

      expect(columnsRes.rowCount).toBeGreaterThan(0);

      const auditLogRes = await verifyPool.query(`
        SELECT table_name FROM information_schema.tables
        WHERE table_schema = 'pipeline' AND table_name = 'audit_log'
      `);

      expect(auditLogRes.rowCount).toBeGreaterThan(0);
    } finally {
      await verifyPool.end();
    }
  });

  it("applies migration sequence twice on an empty database and leaves the required schema", async () => {
    const dbName = "lore_test_empty_hippo";

    await setupSuperuserDb(dbName, superuserPool);
    await setupPrivilegeGuardedSchema(dbName, superuserPool);
    await runMigrations(dbName, MIGRATOR_USER, MIGRATOR_PASSWORD);

    const verifyPool = new pg.Pool({
      host: process.env.LORE_DB_HOST || "localhost",
      port: parseInt(process.env.LORE_DB_PORT || "5432"),
      database: dbName,
      user: process.env.LORE_DB_SUPERUSER || "postgres",
      password: process.env.LORE_DB_PASSWORD || "lore",
    });

    try {
      const auditLogRes = await verifyPool.query(`
        SELECT table_name FROM information_schema.tables
        WHERE table_schema = 'pipeline' AND table_name = 'audit_log'
      `);

      expect(auditLogRes.rowCount).toBeGreaterThan(0);

      const confidenceRes = await verifyPool.query(`
        SELECT column_name
        FROM information_schema.columns
        WHERE table_schema = 'memory' AND table_name = 'facts' AND column_name = 'confidence'
      `);

      expect(confidenceRes.rowCount).toEqual(0);
    } finally {
      await verifyPool.end();
    }
  });
});
