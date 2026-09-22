import { describe, it, expect, beforeAll, afterAll } from "vitest";
import pg from "pg";
import { seedAgentDefaults } from "@re-cinq/lore-shared/project/agents/agent-defaults-seed.js";
import type { ResolvedAgentDefinition } from "@re-cinq/lore-shared/models/agent-definition.js";

const shipped = (
  name: string,
  over: Partial<ResolvedAgentDefinition> = {},
): ResolvedAgentDefinition => ({
  name,
  model: "claude-sonnet-4-6",
  timeout_minutes: 30,
  prompt: "Do the task.\n",
  image: null,
  execution_mode: "claude-code",
  review_required: false,
  project_id: null,
  config: { skills: ["lore-context"] },
  ...over,
});

describe("seedAgentDefaults, against real Postgres", () => {
  let pool: pg.Pool;

  async function eventsFor(name: string): Promise<number> {
    const { rows } = await pool.query<{ n: number }>(
      "SELECT count(*)::int AS n FROM lore.catalog_events WHERE name = $1",
      [name],
    );

    return rows[0].n;
  }

  async function orgRow(name: string) {
    const { rows } = await pool.query(
      `SELECT model, prompt, shipped_default FROM lore.agent_definitions
        WHERE name = $1 AND project_id IS NULL`,
      [name],
    );

    return rows[0];
  }

  beforeAll(async () => {
    pool = new pg.Pool({
      host: process.env.LORE_DB_HOST || "localhost",
      port: parseInt(process.env.LORE_DB_PORT || "5432"),
      database: process.env.LORE_DB_NAME || "lore_test",
      user: process.env.LORE_DB_USER || "lore",
      password: process.env.LORE_DB_PASSWORD || "test",
    });
    await pool.query(
      `INSERT INTO lore.agent_definitions (name, model, timeout_minutes, prompt, execution_mode)
       VALUES ('seed-itest-null', 'claude-sonnet-4-6', 30, NULL, 'claude-code'),
              ('seed-itest-edited', 'gemini-3-flash-preview', 30, 'Do the task.\n', 'claude-code')`,
    );
    await pool.query(
      `UPDATE lore.agent_definitions SET shipped_default = $1::jsonb
        WHERE name = 'seed-itest-edited' AND project_id IS NULL`,
      [JSON.stringify(shipped("seed-itest-edited", { config: null }))],
    );
  });

  afterAll(async () => {
    await pool.query(
      "DELETE FROM lore.catalog_events WHERE name LIKE 'seed-itest-%'",
    );
    await pool.query(
      "DELETE FROM lore.agent_definitions WHERE name LIKE 'seed-itest-%'",
    );
    await pool.end();
  });

  it("inserts a missing seed-itest-new row with its shipped default and one catalog event", async () => {
    const result = await seedAgentDefaults(pool, [shipped("seed-itest-new")]);

    expect({
      result,
      row: await orgRow("seed-itest-new"),
      events: await eventsFor("seed-itest-new"),
    }).toMatchObject({
      result: { inserted: ["seed-itest-new"], updated: [] },
      row: {
        model: "claude-sonnet-4-6",
        prompt: "Do the task.\n",
        shipped_default: {
          model: "claude-sonnet-4-6",
          prompt: "Do the task.\n",
        },
      },
      events: 1,
    });
  });

  it("writes no catalog event when seed-itest-new is seeded again with the same default", async () => {
    const result = await seedAgentDefaults(pool, [shipped("seed-itest-new")]);

    expect({ result, events: await eventsFor("seed-itest-new") }).toEqual({
      result: { inserted: [], updated: [], diverged: [] },
      events: 1,
    });
  });

  it("fills seed-itest-null's NULL prompt with one catalog event", async () => {
    const result = await seedAgentDefaults(pool, [shipped("seed-itest-null")]);

    expect({
      result,
      prompt: (await orgRow("seed-itest-null")).prompt,
      events: await eventsFor("seed-itest-null"),
    }).toMatchObject({
      result: { updated: ["seed-itest-null"] },
      prompt: "Do the task.\n",
      events: 1,
    });
  });

  it("keeps seed-itest-edited's gemini model when the default moves from sonnet to opus", async () => {
    const next = shipped("seed-itest-edited", {
      model: "claude-opus-5",
      config: null,
    });
    const result = await seedAgentDefaults(pool, [next]);

    expect({
      result,
      row: await orgRow("seed-itest-edited"),
      events: await eventsFor("seed-itest-edited"),
    }).toMatchObject({
      result: { updated: [], diverged: ["seed-itest-edited"] },
      row: {
        model: "gemini-3-flash-preview",
        shipped_default: { model: "claude-opus-5" },
      },
      events: 0,
    });
  });
});
