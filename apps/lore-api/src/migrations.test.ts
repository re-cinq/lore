import { describe, it, expect } from "vitest";
import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";

const MIGRATIONS_DIR = join(
  import.meta.dirname,
  "..",
  "..",
  "..",
  "infra",
  "terraform",
  "modules",
  "gke-mcp",
  "lore-platform",
  "charts",
  "ui-helm",
  "migrations",
);

function allMigrationSql(): string {
  return readdirSync(MIGRATIONS_DIR)
    .filter((f) => f.endsWith(".sql"))
    .map((f) => readFileSync(join(MIGRATIONS_DIR, f), "utf-8"))
    .join("\n")
    .toLowerCase();
}

describe("ui-helm migrations — hippo-memory + audit_log backfill", () => {
  const sql = allMigrationSql();

  it("adds the hippo columns to memory.facts idempotently", () => {
    for (const col of [
      "confidence",
      "retrieval_count",
      "last_retrieved_at",
      "half_life_days",
    ]) {
      expect(sql).toMatch(
        new RegExp(
          `alter table memory\\.facts\\s+add column if not exists ${col}`,
        ),
      );
    }
  });

  it("adds the decay columns to memory.memories idempotently", () => {
    for (const col of [
      "retrieval_count",
      "last_retrieved_at",
      "half_life_days",
    ]) {
      expect(sql).toMatch(
        new RegExp(
          `alter table memory\\.memories\\s+add column if not exists ${col}`,
        ),
      );
    }
  });

  it("guards the confidence CHECK constraint with the four tiers", () => {
    expect(sql).toContain(
      "confidence in ('verified', 'observed', 'inferred', 'stale')",
    );
  });

  it("creates memory.fact_conflicts if not exists", () => {
    expect(sql).toMatch(/create table if not exists memory\.fact_conflicts/);
  });

  it("creates pipeline.audit_log if not exists", () => {
    expect(sql).toMatch(/create table if not exists pipeline\.audit_log/);
  });
});
