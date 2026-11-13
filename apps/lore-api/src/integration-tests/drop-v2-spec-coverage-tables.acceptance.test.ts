import { describe, it, expect, beforeAll, afterAll } from "vitest";
import pg from "pg";
import { readFileSync } from "node:fs";
import { join } from "node:path";

describe("0008_drop_v2_spec_coverage_tables", () => {
  let superuserPool: pg.Pool;

  beforeAll(async () => {
    superuserPool = makeSuperuserPool("postgres");
  });

  afterAll(async () => {
    if (superuserPool) {
      await superuserPool.end();
    }
  });

  it("drops all three tables across affected schemas and a second execution succeeds", async () => {
    const dbName = "lore_test_drop_v2";

    await setupSuperuserDb(dbName, superuserPool);
    await setupLegacyV2Schemas(dbName);

    const tablesBefore = await checkV2Tables(dbName);

    expect(tablesBefore).toEqual(
      expect.arrayContaining([
        "team_a.spec_test_links",
        "team_a.spec_statements",
        "team_a.spec_coverage_runs",
        "team_b.spec_test_links",
        "team_b.spec_statements",
        "team_b.spec_coverage_runs",
      ]),
    );

    await runMigration0008(dbName);

    const tablesAfter = await checkV2Tables(dbName);

    expect(tablesAfter).toEqual([]);

    const otherTables = await checkOtherTables(dbName);

    expect(otherTables).toEqual(["team_a.other_table"]);
  });
});

async function setupSuperuserDb(
  dbName: string,
  superuserPool: pg.Pool,
): Promise<void> {
  await superuserPool.query(`DROP DATABASE IF EXISTS ${dbName}`);
  await superuserPool.query(`CREATE DATABASE ${dbName}`);
}

async function setupLegacyV2Schemas(dbName: string): Promise<void> {
  const pool = makeSuperuserPool(dbName);

  try {
    await pool.query(`
      CREATE SCHEMA IF NOT EXISTS team_a;
      CREATE TABLE IF NOT EXISTS team_a.spec_test_links (id serial primary key);
      CREATE TABLE IF NOT EXISTS team_a.spec_statements (id serial primary key);
      CREATE TABLE IF NOT EXISTS team_a.spec_coverage_runs (id serial primary key);
      CREATE TABLE IF NOT EXISTS team_a.other_table (id serial primary key);

      CREATE SCHEMA IF NOT EXISTS team_b;
      CREATE TABLE IF NOT EXISTS team_b.spec_test_links (id serial primary key);
      CREATE TABLE IF NOT EXISTS team_b.spec_statements (id serial primary key);
      CREATE TABLE IF NOT EXISTS team_b.spec_coverage_runs (id serial primary key);
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

async function runMigration0008(dbName: string): Promise<void> {
  const pool = makeSuperuserPool(dbName);
  const mig0008 = readFileSync(
    join(MIGRATIONS_DIR, "0008_drop_v2_spec_coverage_tables.sql"),
    "utf-8",
  );

  try {
    await pool.query(mig0008);
    await pool.query(mig0008);
  } finally {
    await pool.end();
  }
}

async function checkV2Tables(dbName: string): Promise<string[]> {
  const pool = makeSuperuserPool(dbName);

  try {
    const res = await pool.query(`
      SELECT table_schema || '.' || table_name AS full_name
      FROM information_schema.tables
      WHERE table_name IN ('spec_test_links', 'spec_statements', 'spec_coverage_runs')
      ORDER BY full_name
    `);

    return res.rows.map((r) => r.full_name);
  } finally {
    await pool.end();
  }
}

async function checkOtherTables(dbName: string): Promise<string[]> {
  const pool = makeSuperuserPool(dbName);

  try {
    const res = await pool.query(`
      SELECT table_schema || '.' || table_name AS full_name
      FROM information_schema.tables
      WHERE table_name = 'other_table'
      ORDER BY full_name
    `);

    return res.rows.map((r) => r.full_name);
  } finally {
    await pool.end();
  }
}

function makeSuperuserPool(database: string): pg.Pool {
  return new pg.Pool({
    host: process.env.LORE_DB_HOST || "localhost",
    port: parseInt(process.env.LORE_DB_PORT || "5432", 10),
    database,
    user: process.env.LORE_DB_SUPERUSER || "postgres",
    password: process.env.LORE_DB_PASSWORD || "lore",
  });
}
