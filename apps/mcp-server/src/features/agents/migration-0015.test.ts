import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

// Static guard on migration 0015's content (the live apply is verified against a
// throwaway Postgres in CI/PR). Catches accidental removal of a seed row, an
// index, or the task_overrides backfill.

const sql = readFileSync(
  resolve(process.cwd(), "../../infra/terraform/modules/gke-mcp/ui-helm/migrations/0015_agents_table.sql"),
  "utf-8",
);

describe("migration 0015 — agent_definitions table", () => {
  it("creates lore.agent_definitions with the org/project partial unique indexes", () => {
    expect(sql).toMatch(/CREATE TABLE IF NOT EXISTS lore\.agent_definitions/);
    expect(sql).toMatch(/agent_definitions_org_name[\s\S]*?WHERE project_id IS NULL/);
    expect(sql).toMatch(/agent_definitions_proj_name[\s\S]*?WHERE project_id IS NOT NULL/);
  });

  it("seeds an org row for every task-types.yaml task type, idempotently", () => {
    for (const name of [
      "general", "runbook", "implementation", "gap-fill", "review",
      "feature-request", "onboard", "ingest-specs", "ingest-adrs", "ingest-tests",
    ]) {
      expect(sql).toContain(`'${name}'`);
    }
    expect(sql).toMatch(/ON CONFLICT \(name\) WHERE project_id IS NULL DO NOTHING/);
  });

  it("backfills existing settings.task_overrides into per-project rows (object-guarded)", () => {
    expect(sql).toMatch(/jsonb_each\(/);
    expect(sql).toMatch(/jsonb_typeof\(r\.settings->'task_overrides'\) = 'object'/);
    expect(sql).toMatch(/ON CONFLICT \(name, project_id\) WHERE project_id IS NOT NULL DO NOTHING/);
  });

  it("grants lore_ui read only when the role exists (cluster may not have it)", () => {
    expect(sql).toMatch(/IF EXISTS \(SELECT 1 FROM pg_roles WHERE rolname = 'lore_ui'\)/);
    expect(sql).toMatch(/GRANT SELECT ON lore\.agent_definitions TO lore_ui/);
    // The grant must be inside the guard, never an unconditional top-level statement.
    expect(sql).not.toMatch(/\nGRANT SELECT ON lore\.agent_definitions TO lore_ui;/);
  });
});
