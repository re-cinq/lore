import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

const sql = readFileSync(
  resolve(
    process.cwd(),
    "../../deploy/chart/charts/ui-helm/migrations/0139_person_generations.sql",
  ),
  "utf-8",
);

describe("migration 0139, the generation of each person", () => {
  it("creates a table keyed by the bigint GitHub id holding one integer generation", () => {
    expect({
      table:
        /CREATE TABLE IF NOT EXISTS pipeline\.person_generations \(\s*github_id\s+BIGINT PRIMARY KEY,\s*generation\s+INTEGER NOT NULL DEFAULT 0/.test(
          sql,
        ),
      grant:
        /GRANT SELECT, INSERT, UPDATE, DELETE ON pipeline\.person_generations TO lore/.test(
          sql,
        ),
    }).toEqual({ table: true, grant: true });
  });

  it("adds an integer generation column to the sign-in handoff rows and to the session rows", () => {
    expect({
      handoff:
        /ALTER TABLE lore\.login_handoffs\s+ADD COLUMN IF NOT EXISTS generation INTEGER/.test(
          sql,
        ),
      session:
        /ALTER TABLE pipeline\.api_tokens\s+ADD COLUMN IF NOT EXISTS generation INTEGER/.test(
          sql,
        ),
    }).toEqual({ handoff: true, session: true });
  });
});
