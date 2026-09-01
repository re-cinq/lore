import { describe, it, expect, beforeAll, afterAll } from "vitest";
import type { Server } from "@hapi/hapi";
import pg from "pg";
import { PgAgentDefs } from "@re-cinq/lore-shared/project/agents/agent-defs-pg.js";
import { AgentDefsYaml } from "@re-cinq/lore-shared/project/agents/agent-defs-yaml.js";
import { agentDefToCrds } from "@re-cinq/lore-shared/project/agents/agent-crd.js";
import type { ResolvedAgentDefinition } from "@re-cinq/lore-shared/models/agent-definition.js";
import { buildServer } from "../server/build-server.js";

/**
 * The catalog fan-out end to end, against a migrated Postgres: a definition
 * written through the production write path (PgAgentDefs, the same adapter the
 * /agents route uses) must reach a registered cluster-agent through the
 * catalog-events route — snapshot on first contact, ack-advanced tail after,
 * delete as a null definition — and the served entry must render a CRD pair
 * under its project-qualified name.
 *
 * The unit suites prove each half against doubles; what only this tier can
 * prove is the SQL the doubles stand in for — the CTE that appends the event
 * in the same statement as the write (migration 0053), the seed rows and their
 * events (0054), the snapshot/tail reads, the GREATEST cursor advance, and the
 * (name, project_id) re-resolve. The claim suite next door exists for the same
 * reason and this one follows its shape.
 */
const REGISTRATION_TOKEN = "test-registration-token";
const REPO = "test/catalog-repo";
const TASK_TYPE = "catalog-itest-implementation";

interface Registered {
  id: string;
  token: string;
}

describe("the catalog-events fan-out, against real Postgres", () => {
  let pool: pg.Pool;
  let server: Server;
  let defs: PgAgentDefs;
  let repoId: string;
  const prevRegistration = process.env.LORE_CLUSTER_AGENT_REGISTRATION_TOKEN;
  const registered: string[] = [];

  async function register(name: string): Promise<Registered> {
    const res = await server.inject({
      method: "POST",
      url: "/api/cluster-agents/register",
      headers: { authorization: `Bearer ${REGISTRATION_TOKEN}` },
      payload: { name, tags: [] },
    });

    expect(res.statusCode).toBe(200);
    const body = JSON.parse(res.payload) as Registered;

    registered.push(body.id);

    return body;
  }

  interface EventsBody {
    mode: "snapshot" | "tail";
    cursor: string;
    entries: Array<{
      name: string;
      project_id: string | null;
      definition: ResolvedAgentDefinition | null;
    }>;
  }

  async function poll(agent: Registered, ack?: string): Promise<EventsBody> {
    const res = await server.inject({
      method: "GET",
      url: `/api/cluster-agents/${agent.id}/catalog-events${ack === undefined ? "" : `?ack=${ack}`}`,
      headers: { authorization: `Bearer ${agent.token}` },
    });

    expect(res.statusCode).toBe(200);

    return JSON.parse(res.payload) as EventsBody;
  }

  beforeAll(async () => {
    process.env.LORE_CLUSTER_AGENT_REGISTRATION_TOKEN = REGISTRATION_TOKEN;
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
       VALUES ('test', 'catalog-repo', $1) RETURNING id`,
      [REPO],
    );

    repoId = rows[0].id;
    defs = new PgAgentDefs(pool, new AgentDefsYaml());
    server = buildServer(() => pool);
  });

  afterAll(async () => {
    await pool.query("DELETE FROM lore.catalog_events WHERE name = $1", [
      TASK_TYPE,
    ]);
    await pool.query("DELETE FROM lore.agent_definitions WHERE name = $1", [
      TASK_TYPE,
    ]);
    await pool.query("DELETE FROM lore.repos WHERE id = $1", [repoId]);
    await pool.query(
      "DELETE FROM pipeline.cluster_agents WHERE id = ANY($1::uuid[])",
      [registered],
    );
    await server.stop();
    await pool.end();

    if (prevRegistration === undefined) {
      delete process.env.LORE_CLUSTER_AGENT_REGISTRATION_TOKEN;
    } else {
      process.env.LORE_CLUSTER_AGENT_REGISTRATION_TOKEN = prevRegistration;
    }
  });

  it("a fresh agent's first poll is the full snapshot, including the 0054-seeded org defaults", async () => {
    const agent = await register("catalog-itest-fresh");
    const snapshot = await poll(agent);

    expect(snapshot.mode).toBe("snapshot");
    const byName = new Map(snapshot.entries.map((e) => [e.name, e]));

    // The seed migration's rows are present and resolve to full definitions.
    expect(byName.get("implementation")?.definition).toMatchObject({
      name: "implementation",
      execution_mode: "claude-code",
    });
    expect(byName.get("def-validate")?.definition).toMatchObject({
      execution_mode: "station",
    });
    expect(BigInt(snapshot.cursor)).toBeGreaterThanOrEqual(0n);
  });

  it("a write through the production adapter reaches an acked agent as one tail entry, and its served definition renders a qualified CRD pair", async () => {
    const agent = await register("catalog-itest-tail");
    // Land in tail mode by acking the snapshot, exactly as the sync loop does.
    const snapshot = await poll(agent);
    const drained = await poll(agent, snapshot.cursor);

    expect(drained).toMatchObject({ mode: "tail", entries: [] });

    await defs.create(REPO, {
      name: TASK_TYPE,
      model: "claude-sonnet-4-6",
      timeout_minutes: 15,
      prompt: "Integration recipe.",
      image: null,
      execution_mode: "claude-code",
      review_required: false,
      config: { skills: ["lore-pr"] },
    });

    const tail = await poll(agent, drained.cursor);

    expect(tail.mode).toBe("tail");
    expect(tail.entries).toHaveLength(1);
    const entry = tail.entries[0];

    expect(entry).toMatchObject({ name: TASK_TYPE, project_id: repoId });
    expect(entry.definition).toMatchObject({
      name: TASK_TYPE,
      prompt: "Integration recipe.",
      project_id: repoId,
      config: { skills: ["lore-pr"] },
    });

    // The served shape is exactly what the sync loop hands the CRD builder.
    const definition = entry.definition;

    expect(definition).not.toBeNull();

    if (definition) {
      const pair = agentDefToCrds(definition, { mcpUrl: "https://mcp" });
      const qualified = `${TASK_TYPE}--r${repoId.replace(/-/g, "").slice(0, 8)}`;

      expect(pair.agentDefinition.metadata?.name).toBe(qualified);
      expect(pair.station.spec?.agentDefRef).toBe(qualified);
    }

    // The same tail is re-served until acked; after the ack it is empty.
    expect(await poll(agent, drained.cursor)).toEqual(tail);
    expect((await poll(agent, tail.cursor)).entries).toEqual([]);
  });

  it("deleting the override serves a null definition — the delete-the-CRDs signal", async () => {
    const agent = await register("catalog-itest-delete");
    const snapshot = await poll(agent);

    await defs.delete(REPO, TASK_TYPE);

    const tail = await poll(agent, snapshot.cursor);
    const deletion = tail.entries.find((e) => e.name === TASK_TYPE);

    expect(deletion).toEqual({
      name: TASK_TYPE,
      project_id: repoId,
      definition: null,
    });
  });

  it("refuses a poll presenting another agent's token", async () => {
    const owner = await register("catalog-itest-owner");
    const other = await register("catalog-itest-other");

    const res = await server.inject({
      method: "GET",
      url: `/api/cluster-agents/${owner.id}/catalog-events`,
      headers: { authorization: `Bearer ${other.token}` },
    });

    expect(res.statusCode).toBe(403);
  });
});
