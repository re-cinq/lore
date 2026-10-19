import { describe, it, expect, beforeAll, afterAll } from "vitest";
import pg from "pg";
import { seedAgentDefaults } from "@re-cinq/lore-shared/project/agents/agent-defaults-seed.js";

describe("seedAgentDefaults (Acceptance)", () => {
  let pool: pg.Pool;

  beforeAll(async () => {
    pool = new pg.Pool({
      host: process.env.LORE_DB_HOST || "localhost",
      port: parseInt(process.env.LORE_DB_PORT || "5432"),
      database: process.env.LORE_DB_NAME || "lore_test",
      user: process.env.LORE_DB_USER || "lore",
      password: process.env.LORE_DB_PASSWORD || "lore",
    });
  });

  afterAll(async () => {
    await pool.end();
  });

  it("nulls project row fields that are identical to the org row default", async () => {
    await pool.query("BEGIN");
    try {
      // 1. Setup org row
      await pool.query(
        `INSERT INTO lore.agent_definitions (
          name, model, timeout_minutes, prompt, image, execution_mode, review_required, config
        ) VALUES (
          'test-agent', 'claude-sonnet-4-6', 30, 'org prompt', null, 'claude-code', false, '{"skills":[]}'
        )`,
      );

      // 2. Setup project row that has a copied prompt
      await pool.query(
        `INSERT INTO lore.agent_definitions (
          name, model, timeout_minutes, prompt, image, execution_mode, review_required, config, project_id
        ) VALUES (
          'test-agent', 'claude-sonnet-4-6', 30, 'org prompt', null, 'claude-code', false, '{"skills":[]}', 'proj-1'
        )`,
      );

      // Run seed/migration logic
      await seedAgentDefaults(pool);

      const { rows } = await pool.query(
        `SELECT prompt FROM lore.agent_definitions WHERE name = 'test-agent' AND project_id = 'proj-1'`,
      );

      // The copied prompt should be set to null
      expect(rows[0].prompt).toBeNull();
    } finally {
      await pool.query("ROLLBACK");
    }
  });
});
