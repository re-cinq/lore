#!/usr/bin/env node
// Fail when a column added by a baseline `setup-*.sh` has no ordered migration
// behind it.
//
// The baseline scripts run ONCE, when an operator provisions a cluster. A column
// appended to one afterwards reaches a fresh database and no existing one, and
// nothing else converges it — `lore.schema_migrations` only tracks the ordered
// files. That gap is invisible while readers use `SELECT *`, and fatal the
// moment one names its columns: on 2026-08-20 the Floor's task queue generated
// its SELECT from PIPELINE_TASK_COLUMNS, hit `42703: column
// "dark_factory_overrides" does not exist` on its first poll, crash-looped, took
// /healthz down, wedged the umbrella rollout, and failed every ci-ingest that
// needs a live Floor. Ten columns were in that state; one had surfaced.
//
// This is the guard that was missing. `models.test.ts` proves a column map
// matches the SCHEMA FILE — nothing proved the schema file had reached a
// database.
//
// Detection is deliberately syntactic. It reads what the SQL says rather than
// what a cluster has, so it runs in CI with no database and no credentials.

import { readdirSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const repoRoot = join(dirname(fileURLToPath(import.meta.url)), "..");

export const BOOTSTRAP_DIR = "scripts/infra";
export const MIGRATIONS_DIR =
  "infra/terraform/modules/gke-mcp/lore-platform/charts/ui-helm/migrations";

/** SQL with comments dropped and whitespace flattened, so a statement split
 *  across lines reads the same as one written on a single line — the ALTER that
 *  added `dark_factory_overrides` is a two-line one, and a line-wise matcher
 *  misses precisely the column that caused the outage. */
export function flatten(sql) {
  return sql.replace(/--[^\n]*/g, " ").replace(/\s+/g, " ");
}

/** Every `<schema>.<table>.<column>` an ALTER in this SQL adds. One statement
 *  may carry several comma-separated ADD COLUMN clauses. */
export function addedColumns(sql) {
  const added = [];

  for (const statement of flatten(sql).matchAll(
    /ALTER TABLE (\w+\.\w+)([^;]*);/g,
  )) {
    for (const column of statement[2].matchAll(
      /ADD COLUMN (?:IF NOT EXISTS )?(\w+)/g,
    )) {
      added.push(`${statement[1]}.${column[1]}`);
    }
  }

  return added;
}

/** Every `<schema>.<table>.<column>` this SQL DECLARES — added by an ALTER, or
 *  named in a CREATE TABLE, which covers a table a migration creates whole. */
export function declaredColumns(sql) {
  const declared = new Set(addedColumns(sql));

  for (const statement of flatten(sql).matchAll(
    /CREATE TABLE (?:IF NOT EXISTS )?(\w+\.\w+) *\(([^;]*)\);/g,
  )) {
    for (const definition of statement[2].split(",")) {
      const name = definition.trim().match(/^(\w+)/);

      if (name) {
        declared.add(`${statement[1]}.${name[1]}`);
      }
    }
  }

  return declared;
}

function readAll(dir, matches) {
  return readdirSync(join(repoRoot, dir))
    .filter(matches)
    .map((file) => ({
      file,
      sql: readFileSync(join(repoRoot, dir, file), "utf8"),
    }));
}

/** Bootstrap-added columns no migration provides. */
export function uncoveredColumns(bootstrap, migrations) {
  const covered = new Set();

  for (const { sql } of migrations) {
    for (const column of declaredColumns(sql)) {
      covered.add(column);
    }
  }

  return bootstrap
    .flatMap(({ file, sql }) =>
      addedColumns(sql).map((column) => ({ file, column })),
    )
    .filter(({ column }) => !covered.has(column));
}

const bootstrap = readAll(BOOTSTRAP_DIR, (f) => /^setup-.*\.sh$/.test(f));
const migrations = readAll(MIGRATIONS_DIR, (f) => f.endsWith(".sql"));
const uncovered = uncoveredColumns(bootstrap, migrations);

if (uncovered.length > 0) {
  console.error(
    "ERROR: a baseline script adds columns that no migration provides.\n" +
      "A cluster provisioned before the ALTER was appended will never get them,\n" +
      "and the first generated SELECT that names one fails with 42703.\n",
  );

  for (const { file, column } of uncovered) {
    console.error(`  ${column}  (${file})`);
  }
  console.error(
    `\nAdd an idempotent migration under ${MIGRATIONS_DIR} declaring them.`,
  );
  process.exit(1);
}

console.log(
  `[lore] every bootstrap-added column has a migration behind it ` +
    `(${bootstrap.length} script(s), ${migrations.length} migration(s)).`,
);
