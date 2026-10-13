import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

const sql = readFileSync(
  resolve(
    process.cwd(),
    "../../infra/terraform/modules/gke-mcp/lore-platform/charts/ui-helm/migrations/0106_auto_merge_kpis.sql",
  ),
  "utf-8",
);

describe("migration 0106 — the auto-merge KPI view", () => {
  it("reads lore_reviewer_approved and pr_merged audit rows, not auto_merge_armed", () => {
    expect(sql).toMatch(
      /WHERE a\.event_type IN \('lore_reviewer_approved', 'pr_merged'\);/,
    );
    expect(sql).not.toContain("auto_merge_armed");
  });
});
