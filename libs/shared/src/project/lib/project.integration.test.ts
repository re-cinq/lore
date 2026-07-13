import { describe, it, expect, afterAll } from "vitest";
import { randomUUID } from "node:crypto";
import { Pool } from "pg";
import { createProject } from "./project-factory.js";
import type { DgraphClientPort } from "../../memory-store.js";

/**
 * End-to-end Project wiring against the REAL local Postgres — proves the
 * dynamic-import factory + pg adapters (settings/tasks/knowledge) run against a
 * live connection, not just fakes. Container-gated: skips when Postgres is
 * unreachable so `npm test` passes without a DB. Bring one up with `npm run db:up`.
 */

const PG_CONFIG = {
  host: "localhost",
  port: 5432,
  database: "lore",
  user: "postgres",
  password: "lore",
};

async function pgReachable(): Promise<boolean> {
  try {
    const probe = new Pool({ ...PG_CONFIG, connectionTimeoutMillis: 1000 });
    await probe.query("select 1");
    await probe.end();
    return true;
  } catch {
    return false;
  }
}

const reachable = await pgReachable();
const noDgraph = {} as DgraphClientPort;

describe.skipIf(!reachable)("Project (live Postgres)", () => {
  const pool = new Pool(PG_CONFIG);
  const fullName = `lore-smoke/repo-${randomUUID()}`;

  afterAll(async () => {
    await pool.query("DELETE FROM lore.repos WHERE full_name = $1", [fullName]);
    await pool.end();
  });

  it("resolves settings, queries tasks, and reads the graph through a real connection", async () => {
    await pool.query(
      `INSERT INTO lore.repos (owner, name, full_name, settings)
       VALUES ($1, $2, $3, $4::jsonb)`,
      [
        "lore-smoke",
        fullName.split("/")[1],
        fullName,
        JSON.stringify({ dark_factory: { enabled: true } }),
      ],
    );
    const project = await createProject(fullName, pool, noDgraph, {});

    const settings = await project.settings.resolve();
    const pending = await project.tasks.pendingTasks();
    const graph = await project.knowledge.queryLiveGraph();

    expect(settings.enabled).toBe(true);
    expect(Array.isArray(pending)).toBe(true);
    expect(Array.isArray(graph)).toBe(true);
  });
});
