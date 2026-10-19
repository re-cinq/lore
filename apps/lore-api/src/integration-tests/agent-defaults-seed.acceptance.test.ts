import { describe, it, expect, beforeAll, afterAll } from "vitest";
import pg from "pg";
import { seedAgentDefaults } from "@re-cinq/lore-shared/project/agents/agent-defaults-seed.js";

const AGENT_NAME = "test-agent-seed-acc";
const REPO_FULL_NAME = "test-acc/seed-acc-repo";

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
    await pool.query(`DELETE FROM lore.agent_definitions WHERE name = $1`, [
      AGENT_NAME,
    ]);
    await pool.query(`DELETE FROM lore.repos WHERE full_name = $1`, [
      REPO_FULL_NAME,
    ]);
    await pool.end();
  });

  it("nulls project row fields that are identical to the org row default", async () => {
    // 1. Setup org row (committed so seedAgentDefaults can see it on its own connection)
    await pool.query(
      `INSERT INTO lore.agent_definitions (
        name, model, timeout_minutes, prompt, image, execution_mode, review_required, config
      ) VALUES (
        $1, 'claude-sonnet-4-6', 30, 'org prompt', null, 'claude-code', false, '{"skills":[]}'
      )`,
      [AGENT_NAME],
    );

    // 2. Insert a real repo row to satisfy the FK on project_id (uuid references lore.repos)
    const { rows: repoRows } = await pool.query(
      `INSERT INTO lore.repos (owner, name, full_name, onboarding_pr_merged)
       VALUES ('test-acc', 'seed-acc-repo', $1, false)
       RETURNING id`,
      [REPO_FULL_NAME],
    );
    const projectId: string = repoRows[0].id;

    // 3. Setup project row that carries a full copy of the org prompt
    await pool.query(
      `INSERT INTO lore.agent_definitions (
        name, model, timeout_minutes, prompt, image, execution_mode, review_required, config, project_id
      ) VALUES (
        $1, 'claude-sonnet-4-6', 30, 'org prompt', null, 'claude-code', false, '{"skills":[]}', $2
      )`,
      [AGENT_NAME, projectId],
    );

    // Run seed — it always executes NULLIFY_DUPLICATE_PROJECT_FIELDS_SQL, which
    // sets to null any project-row field identical to the matching org-row field.
    await seedAgentDefaults(pool);

    const { rows } = await pool.query(
      `SELECT prompt FROM lore.agent_definitions WHERE name = $1 AND project_id = $2`,
      [AGENT_NAME, projectId],
    );

    expect(rows[0].prompt).toBeNull();
  });
});
