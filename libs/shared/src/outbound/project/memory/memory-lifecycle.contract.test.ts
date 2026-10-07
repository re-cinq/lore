import { enforceTrue } from "../../../lib/enforce.js";

import { describe, it, expect, afterAll } from "vitest";
import { randomUUID } from "node:crypto";
import { Pool } from "pg";
import { PgMemoryLifecycle } from "./memory-lifecycle-pg.js";

const PG_CONFIG = {
  host: process.env.PGHOST ?? "localhost",
  port: Number(process.env.PGPORT ?? 5432),
  database: process.env.PGDATABASE ?? "lore",
  user: process.env.PGUSER ?? "lore",
  password: process.env.PGPASSWORD ?? "lore",
};

async function pgAvailable(): Promise<{ ok: boolean; why: string }> {
  let probe: Pool | undefined;

  try {
    probe = new Pool({ ...PG_CONFIG, connectionTimeoutMillis: 1000 });

    const { rows } = await probe.query<{ present: boolean }>(
      `SELECT to_regclass('memory.fact_conflicts') IS NOT NULL AS present`,
    );

    return rows[0]?.present
      ? { ok: true, why: "" }
      : {
          ok: false,
          why: "memory.fact_conflicts is absent — migrations not applied",
        };
  } catch (err) {
    return { ok: false, why: `unreachable: ${(err as Error).message}` };
  } finally {
    await probe?.end();
  }
}

const pg = await pgAvailable();
const pools: Pool[] = [];

afterAll(async () => {
  await Promise.all(pools.map((p) => p.end()));
});

describe("the Postgres implementation is actually exercised", () => {
  it("runs the Postgres contract, or explains why it is skipped", () => {
    enforceTrue(
      !(!pg.ok && process.env.LORE_REQUIRE_PG_CONTRACT === "1"),
      Error,
      `Postgres contract required but ${pg.why}`,
    );

    expect(pg.ok || pg.why.length > 0).toBe(true);
  });
});

describe.skipIf(!pg.ok)("PgMemoryLifecycle against Postgres", () => {
  it("purges an invalidated fact that a conflict row and invalidated_by point at (#2366)", async () => {
    const pool = new Pool(PG_CONFIG);

    pools.push(pool);
    const agent = `agent-${randomUUID().slice(0, 8)}`;
    const { rows: mem } = await pool.query<{ id: string }>(
      `INSERT INTO memory.memories (agent_id, key, value) VALUES ($1, 'k', 'v') RETURNING id`,
      [agent],
    );
    const insertFact = async (validTo: string | null) =>
      (
        await pool.query<{ id: string }>(
          `INSERT INTO memory.facts (memory_id, fact_text, valid_to)
           VALUES ($1, $2, ${validTo}) RETURNING id`,
          [mem[0]!.id, `fact ${randomUUID()}`],
        )
      ).rows[0]!.id;
    const oldId = await insertFact("now() - interval '90 days'");
    const newId = await insertFact(null);

    await pool.query(
      `INSERT INTO memory.fact_conflicts (old_fact_id, new_fact_id, similarity) VALUES ($1, $2, 0.95)`,
      [oldId, newId],
    );
    await pool.query(
      `UPDATE memory.facts SET invalidated_by = $1 WHERE id = $2`,
      [newId, oldId],
    );
    await pool.query(
      `UPDATE memory.facts SET invalidated_by = $1 WHERE id = $2`,
      [oldId, newId],
    );

    const deleted = await new PgMemoryLifecycle(
      pool as never,
    ).deleteOldestInvalidatedFacts(agent, 10, 30);

    const { rows: left } = await pool.query<{ id: string }>(
      `SELECT id FROM memory.facts WHERE id = ANY($1)`,
      [[oldId, newId]],
    );
    const { rows: conflicts } = await pool.query(
      `SELECT 1 FROM memory.fact_conflicts WHERE old_fact_id = $1`,
      [oldId],
    );

    expect({
      deleted,
      left: left.map((r) => r.id),
      conflicts: conflicts.length,
    }).toEqual({ deleted: 1, left: [newId], conflicts: 0 });
  });
});
