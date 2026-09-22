import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

const sql = readFileSync(
  resolve(
    process.cwd(),
    "../../infra/terraform/modules/gke-mcp/lore-platform/charts/ui-helm/migrations/0086_agent_definitions_shipped_default.sql",
  ),
  "utf-8",
);

describe("migration 0086 — the shipped default an org row was last seeded with", () => {
  it("adds a nullable shipped_default JSONB column, idempotently", () => {
    expect(sql).toMatch(
      /ALTER TABLE lore\.agent_definitions\s+ADD COLUMN IF NOT EXISTS shipped_default JSONB;/,
    );
  });
});
