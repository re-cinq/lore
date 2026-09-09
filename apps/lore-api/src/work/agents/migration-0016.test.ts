import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

const sql = readFileSync(
  resolve(
    process.cwd(),
    "../../infra/terraform/modules/gke-mcp/lore-platform/charts/ui-helm/migrations/0016_rename_agents_to_agent_definitions.sql",
  ),
  "utf-8",
);

describe("migration 0016 — rename agents -> agent_definitions", () => {
  it("renames the table and both partial indexes, each guarded with IF EXISTS", () => {
    expect(sql).toMatch(
      /ALTER TABLE IF EXISTS lore\.agents RENAME TO agent_definitions/,
    );
    expect(sql).toMatch(
      /ALTER INDEX IF EXISTS lore\.agents_org_name RENAME TO agent_definitions_org_name/,
    );
    expect(sql).toMatch(
      /ALTER INDEX IF EXISTS lore\.agents_proj_name RENAME TO agent_definitions_proj_name/,
    );
  });

  it("guards every DDL statement with IF EXISTS (no-op on a fresh DB)", () => {
    const alters = sql.match(/^\s*ALTER\s+(TABLE|INDEX)\b.*$/gim) ?? [];

    expect(alters.length).toBe(3);

    for (const stmt of alters) {
      expect(stmt).toMatch(/IF EXISTS/);
    }
  });
});
