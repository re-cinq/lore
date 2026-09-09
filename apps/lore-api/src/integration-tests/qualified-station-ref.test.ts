import { describe, it, expect, beforeAll, afterAll } from "vitest";
import pg from "pg";
import { qualifiedStationRef } from "@re-cinq/lore-shared/project/agents/agent-defs-pg.js";

const REPO = "test/qualified-ref";

describe("qualifiedStationRef, against real Postgres", () => {
  let pool: pg.Pool;
  let repoId: string;
  const agentIds: string[] = [];

  const cluster = async (name: string): Promise<string> => {
    const { rows } = await pool.query<{ id: string }>(
      `INSERT INTO pipeline.cluster_agents (name, tags, token_hash)
       VALUES ($1, '{}', $2) RETURNING id`,
      [name, `hash-${name}`],
    );

    agentIds.push(rows[0].id);

    return rows[0].id;
  };

  const verdict = (
    clusterAgentId: string,
    state: "applied" | "refused",
    reason: string | null,
  ): Promise<unknown> =>
    pool.query(
      `INSERT INTO lore.catalog_apply_status
         (cluster_agent_id, name, project_id, state, reason)
       VALUES ($1, 'code-review', $2, $3, $4)`,
      [clusterAgentId, repoId, state, reason],
    );

  beforeAll(async () => {
    pool = new pg.Pool({
      host: process.env.LORE_DB_HOST || "localhost",
      port: parseInt(process.env.LORE_DB_PORT || "5432"),
      database: process.env.LORE_DB_NAME || "lore_test",
      user: process.env.LORE_DB_USER || "lore",
      password: process.env.LORE_DB_PASSWORD || "test",
    });
    await pool.query("SELECT 1");
    const { rows } = await pool.query<{ id: string }>(
      `INSERT INTO lore.repos (owner, name, full_name)
       VALUES ('test', 'qualified-ref', $1) RETURNING id`,
      [REPO],
    );

    repoId = rows[0].id;
    await pool.query(
      `INSERT INTO lore.agent_definitions
         (name, execution_mode, review_required, project_id)
       VALUES ('code-review', 'claude-code', false, $1)`,
      [repoId],
    );
  });

  afterAll(async () => {
    await pool.query(
      "DELETE FROM lore.catalog_apply_status WHERE project_id = $1",
      [repoId],
    );
    await pool.query(
      "DELETE FROM lore.agent_definitions WHERE project_id = $1",
      [repoId],
    );
    await pool.query(
      "DELETE FROM pipeline.cluster_agents WHERE id = ANY($1::uuid[])",
      [agentIds],
    );
    await pool.query("DELETE FROM lore.repos WHERE id = $1", [repoId]);
    await pool.end();
  });

  it("qualifies an override no cluster has reported on — an absent verdict is not a refusal", async () => {
    expect(await qualifiedStationRef(pool, "code-review", REPO)).toEqual(
      `code-review--r${repoId.replace(/-/g, "").slice(0, 8)}`,
    );
  });

  it("falls back to the org default once every reporting cluster refused it", async () => {
    await verdict(
      await cluster("qr-central"),
      "refused",
      "no gemini credential",
    );

    expect(await qualifiedStationRef(pool, "code-review", REPO)).toEqual(
      "code-review",
    );
  });

  it("qualifies again as soon as one cluster applied it, so a single refusal cannot veto the rest", async () => {
    await verdict(await cluster("qr-satellite"), "applied", null);

    expect(await qualifiedStationRef(pool, "code-review", REPO)).toEqual(
      `code-review--r${repoId.replace(/-/g, "").slice(0, 8)}`,
    );
  });

  it("leaves a repo with no override on the bare name", async () => {
    expect(
      await qualifiedStationRef(pool, "code-review", "test/no-such-repo"),
    ).toEqual("code-review");
  });
});
