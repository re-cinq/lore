import { test } from "node:test";
import assert from "node:assert/strict";
import {
  addedColumns,
  declaredColumns,
  uncoveredColumns,
} from "./check-bootstrap-columns.mjs";

test("reads an ALTER written across two lines", () => {
  // The ALTER that added dark_factory_overrides is a two-line one, and it is the
  // column that crash-looped production — a line-wise matcher misses exactly the
  // case the guard exists for.
  assert.deepEqual(
    addedColumns(
      "ALTER TABLE pipeline.tasks\n  ADD COLUMN IF NOT EXISTS dark_factory_overrides JSONB DEFAULT NULL;",
    ),
    ["pipeline.tasks.dark_factory_overrides"],
  );
});

test("reads every clause of one comma-separated ALTER", () => {
  assert.deepEqual(
    addedColumns(
      "ALTER TABLE pipeline.tasks ADD COLUMN IF NOT EXISTS log_url TEXT, ADD COLUMN IF NOT EXISTS actor TEXT;",
    ),
    ["pipeline.tasks.log_url", "pipeline.tasks.actor"],
  );
});

test("ignores a commented-out ALTER", () => {
  assert.deepEqual(
    addedColumns("-- ALTER TABLE lore.repos ADD COLUMN outcome_stats JSONB;"),
    [],
  );
});

test("counts a column a migration declares in its own CREATE TABLE", () => {
  assert.ok(
    declaredColumns(
      "CREATE TABLE IF NOT EXISTS pipeline.events (\n  id UUID PRIMARY KEY,\n  claimed_at TIMESTAMPTZ\n);",
    ).has("pipeline.events.claimed_at"),
  );
});

test("a CREATE TABLE for another table does not cover the column", () => {
  // 0017 creates a features table carrying issue_number; that says nothing about
  // pipeline.tasks.issue_number, which is what this guard is asked about.
  assert.deepEqual(
    uncoveredColumns(
      [
        {
          file: "setup-agent-schema.sh",
          sql: "ALTER TABLE pipeline.tasks ADD COLUMN IF NOT EXISTS issue_number INT;",
        },
      ],
      [
        {
          file: "0017_feature_planning.sql",
          sql: "CREATE TABLE lore.features (\n  id UUID,\n  issue_number INTEGER\n);",
        },
      ],
    ),
    [{ file: "setup-agent-schema.sh", column: "pipeline.tasks.issue_number" }],
  );
});

test("a migration ALTER for the same table covers it", () => {
  assert.deepEqual(
    uncoveredColumns(
      [
        {
          file: "setup-agent-schema.sh",
          sql: "ALTER TABLE pipeline.tasks ADD COLUMN IF NOT EXISTS issue_number INT;",
        },
      ],
      [
        {
          file: "0043_tasks_late_columns.sql",
          sql: "ALTER TABLE pipeline.tasks ADD COLUMN IF NOT EXISTS issue_number INTEGER;",
        },
      ],
    ),
    [],
  );
});
