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

describe("ui-helm migrations — 0112 lore.skill_definitions ([validated by migrations](specs/org-skills/spec.md#L20))", () => {
  const sql = allMigrationSql();

  it("creates lore.skill_definitions table if not exists ([validated by](specs/org-skills/spec.md#L20))", () => {
    expect(sql).toMatch(/create table if not exists lore\.skill_definitions/);
  });
});

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

describe("ui-helm migrations — 0121 user sessions", () => {
  const sql = allMigrationSql();

  it("adds the user token columns and kind check to pipeline.api_tokens", () => {
    for (const fragment of [
      "add column if not exists kind text not null default 'service'",
      "api_tokens_kind_check",
      "add column if not exists login text",
      "add column if not exists display_name text",
      "add column if not exists avatar_url text",
      "add column if not exists repos text[] not null default '{}'",
    ]) {
      expect(sql).toContain(fragment);
    }
  });

  it("creates lore.login_handoffs for the one-time state and redeem codes", () => {
    expect(sql).toMatch(/create table if not exists lore\.login_handoffs/);
  });
});
