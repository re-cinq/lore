import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";

// Static guard on migration 0035's content (the live apply + fixture run
// against a throwaway Postgres in .github/workflows/migrations.yml). Catches
// a reordering that could delete before copying, loss of the dedupe guard,
// re-introduction of the generated search_tsv column into the INSERT list,
// or removal of the insufficient_privilege skip.

const sql = readFileSync(
  new URL(
    "../../../../../infra/terraform/modules/gke-mcp/lore-platform/charts/ui-helm/migrations/0035_migrate_legacy_org_shared_chunks.sql",
    import.meta.url,
  ),
  "utf-8",
);

describe("migration 0035 — move legacy org_shared chunks into team schemas", () => {
  it("guards the copy with a per-file NOT EXISTS on repo + file_path in the target", () => {
    expect(sql).toMatch(
      /NOT EXISTS \(\s*SELECT 1 FROM %I\.chunks t\s*WHERE t\.repo = o\.repo AND t\.file_path = o\.file_path\s*\)/,
    );
    expect(sql).toMatch(/ON CONFLICT \(id\) DO NOTHING/);
  });

  it("copies and deletes in one statement so both share a snapshot and fail together", () => {
    const insertAt = sql.indexOf("INSERT INTO %I.chunks");
    const deleteAt = sql.indexOf("DELETE FROM org_shared.chunks");

    expect(insertAt).toBeGreaterThan(-1);
    expect(deleteAt).toBeGreaterThan(insertAt);
    expect(sql).toMatch(/WITH moved AS \(/);
    expect(sql).toMatch(/o\.id IN \(SELECT id FROM moved\)/);
  });

  it("omits the generated search_tsv column from the INSERT column list", () => {
    const columnList = sql.match(/INSERT INTO %I\.chunks\s*\(([^)]+)\)/)?.[1];

    expect(columnList).toMatch(/\bid\b/);
    expect(columnList).toMatch(/\bembedding\b/);
    expect(columnList).toMatch(/\bingested_at\b/);
    expect(columnList).not.toMatch(/search_tsv/);
  });

  it("adopts only classifyFile content types into reindex ownership, when provenance is absent", () => {
    expect(sql).toMatch(/o\.metadata->>'ingested_by' IS NULL/);
    expect(sql).toMatch(/o\.content_type IN \('doc', 'code', 'adr', 'spec'\)/);
    expect(sql).toMatch(/'migrated_from', 'org_shared'/);
  });

  it("interpolates schema names with %I and repo/team values with %L only", () => {
    expect(sql).toMatch(/format\(\s*\$q\$/);
    expect(sql).toMatch(
      /\$q\$, r\.team, r\.team, r\.full_name, r\.team, r\.full_name, r\.team\)/,
    );
    expect(sql).toMatch(/WHERE o\.repo = %L/);
    expect(sql).toMatch(/o\.content_type, %L, o\.repo/);
    expect(sql).not.toMatch(/\|\| r\.(team|full_name)/);
  });

  it("skips repos the lore runner cannot write, with a NOTICE", () => {
    expect(sql).toMatch(/WHEN insufficient_privilege THEN/);
    expect(sql).toMatch(/RAISE NOTICE 'skip repo/);
  });

  it("targets only real team schemas resolved from lore.repos, never org_shared itself", () => {
    expect(sql).toMatch(/FROM lore\.repos rep/);
    expect(sql).toMatch(/rep\.team ~ '\^\[a-z\]\[a-z0-9_\]\{0,62\}\$'/);
    expect(sql).toMatch(/rep\.team <> 'org_shared'/);
    expect(sql).toMatch(
      /c\.relnamespace = n\.oid AND c\.relname = 'chunks' AND c\.relkind = 'r'/,
    );
  });
});
