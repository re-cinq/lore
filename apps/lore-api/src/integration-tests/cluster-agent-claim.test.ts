import { describe, it, expect, beforeAll, afterAll } from "vitest";
import type { Server } from "@hapi/hapi";
import pg from "pg";
import { PgAssemblyRuns } from "@re-cinq/lore-shared/project/assembly-runs/assembly-runs-pg.js";
import type { LoreTaskSpec } from "@re-cinq/lore-shared";
import { buildServer } from "../server/build-server.js";
import { restoreEnv } from "./restore-env.js";

/**
 * Register, then claim, against a migrated Postgres.
 *
 * The claim is a single `FOR UPDATE SKIP LOCKED` CTE with three preconditions
 * (`status = 'queued'`, `dispatch_spec IS NOT NULL`, `required_tags <@ tags`)
 * and it is the ONE query that decides whether a run ever becomes a pod. The
 * route's own tests answer it from a fake port, which proves the authZ and
 * nothing about the SQL — and the `<@` containment in particular is the kind of
 * operator that reads right and is backwards.
 *
 * This matters more since dispatch went pull-only for every task type: a
 * runbook, an onboard and a review used to be pushed straight at a cluster, so
 * this query was not in their path at all. Now nothing runs without it.
 *
 * Both halves are the real thing: the rows are written through `PgAssemblyRuns`
 * exactly as the Floor's launch seam writes them, and the claim goes through the
 * HTTP route with the per-agent token registration actually minted.
 */
const REGISTRATION_TOKEN = "test-registration-token";
const REPO = "test/claim-repo";

interface Registered {
  id: string;
  token: string;
}

describe("the cluster-agent claim, against real Postgres", () => {
  let pool: pg.Pool;
  let server: Server;
  let runs: PgAssemblyRuns;
  const prevRegistration = process.env.LORE_CLUSTER_AGENT_REGISTRATION_TOKEN;
  const registered: string[] = [];
  const runIds: string[] = [];

  /** Register a cluster the way a booting cluster-agent does. */
  async function register(name: string, tags: string[]): Promise<Registered> {
    const res = await server.inject({
      method: "POST",
      url: "/api/cluster-agents/register",
      headers: { authorization: `Bearer ${REGISTRATION_TOKEN}` },
      payload: { name, tags },
    });

    expect(res.statusCode).toBe(200);
    const body = JSON.parse(res.payload) as Registered;

    registered.push(body.id);

    return body;
  }

  /** One queued, armed visit — what the Floor's launch seam leaves behind. */
  async function enqueue(
    requiredTags: string[],
    spec: Partial<LoreTaskSpec> = {},
  ): Promise<{ runId: string; nodeRowId: string }> {
    const runId = await runs.start({
      blueprintName: "runbook",
      repo: REPO,
      branch: "lore/runbook/integration",
    });

    runIds.push(runId);
    const { nodeRowId } = await runs.ensureStationRun({
      assemblyRunId: runId,
      nodeId: "agent",
      iteration: 1,
      agentCrName: "agent-integrat",
      status: "queued",
      requiredTags,
      dispatchSpec: {
        taskType: "runbook",
        targetRepo: REPO,
        name: "agent-integrat",
        ...spec,
      },
    });

    return { runId, nodeRowId };
  }

  async function claim(
    agent: Registered,
  ): Promise<{ statusCode: number; body: Record<string, unknown> | null }> {
    const res = await server.inject({
      method: "POST",
      url: `/api/cluster-agents/${agent.id}/claim`,
      headers: { authorization: `Bearer ${agent.token}` },
    });

    return {
      statusCode: res.statusCode,
      body: res.payload ? (JSON.parse(res.payload) as never) : null,
    };
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
    runs = new PgAssemblyRuns(pool);
    server = buildServer(() => pool);
  });

  afterAll(async () => {
    // The claim scan is global, so this suite's rows must not outlive it.
    await pool.query(
      "DELETE FROM pipeline.station_runs WHERE assembly_run_id = ANY($1::uuid[])",
      [runIds],
    );
    await pool.query(
      "DELETE FROM pipeline.assembly_runs WHERE id = ANY($1::uuid[])",
      [runIds],
    );
    await pool.query(
      "DELETE FROM pipeline.cluster_agents WHERE id = ANY($1::uuid[])",
      [registered],
    );
    await server.stop();
    await pool.end();

    restoreEnv("LORE_CLUSTER_AGENT_REGISTRATION_TOKEN", prevRegistration);
  });

  it("hands a registered agent the visit it enqueued, with its dispatch spec intact", async () => {
    const agent = await register("integration-central", ["node:agent"]);
    const { runId, nodeRowId } = await enqueue(["node:agent"]);

    let claimed = await claim(agent);

    while (
      claimed.statusCode === 200 &&
      claimed.body?.assembly_run_id !== runId
    ) {
      claimed = await claim(agent);
    }

    expect(claimed.statusCode).toBe(200);
    expect(claimed.body).toMatchObject({
      node_row_id: nodeRowId,
      node_id: "agent",
      iteration: 1,
      agent_cr_name: "agent-integrat",
      spec: { taskType: "runbook", name: "agent-integrat" },
    });
  });

  it("marks the row claimed by the agent that took it, so the reaper can see whose it is", async () => {
    const agent = await register("integration-claimer", ["node:agent", "gpu"]);
    const { nodeRowId } = await enqueue(["node:agent", "gpu"]);

    let claimed = await claim(agent);

    while (
      claimed.statusCode === 200 &&
      claimed.body?.node_row_id !== nodeRowId
    ) {
      claimed = await claim(agent);
    }

    const { rows } = await pool.query<{
      status: string;
      cluster_agent_id: string;
      claimed_at: Date | null;
    }>(
      "SELECT status, cluster_agent_id, claimed_at FROM pipeline.station_runs WHERE id = $1",
      [nodeRowId],
    );

    expect(rows[0]).toMatchObject({
      status: "claimed",
      cluster_agent_id: agent.id,
    });
    expect(rows[0].claimed_at).not.toBeNull();
  });

  it("does not hand a run to an agent missing one of its required tags", async () => {
    // `required_tags <@ agent_tags` — containment, in that direction. Reversed,
    // a cluster advertising one tag would claim everything.
    const agent = await register("integration-narrow", ["node:agent"]);

    await enqueue(["node:agent", "gpu"]);

    // Drain whatever else the global queue holds; the assertion below is about
    // what this agent was ALLOWED to take, not about the queue being empty.
    let claimed = await claim(agent);

    while (claimed.statusCode === 200) {
      claimed = await claim(agent);
    }

    expect(claimed.statusCode).toBe(204);
    // Nothing this suite queued with `gpu` may appear among what it was given.
    const { rows } = await pool.query<{ id: string }>(
      "SELECT id::text FROM pipeline.station_runs WHERE cluster_agent_id = $1",
      [agent.id],
    );

    for (const row of rows) {
      const { rows: tagRows } = await pool.query<{ required_tags: string[] }>(
        "SELECT required_tags FROM pipeline.station_runs WHERE id = $1",
        [row.id],
      );

      expect(tagRows[0].required_tags).not.toContain("gpu");
    }
  });

  it("does not hand out a queued row that has not been armed yet", async () => {
    // The assembly-line walk still writes the row and arms it in two statements,
    // so a crash between them leaves a queued visit with no spec. Claiming it
    // would consume the visit and hand a cluster nothing to launch — the run
    // would then wait out the queue bound with its row already marked claimed.
    const agent = await register("integration-unarmed", ["unarmed-tag"]);
    const runId = await runs.start({
      blueprintName: "runbook",
      repo: REPO,
      branch: "lore/runbook/unarmed",
    });

    runIds.push(runId);
    await runs.ensureStationRun({
      assemblyRunId: runId,
      nodeId: "agent",
      iteration: 1,
      status: "queued",
      requiredTags: ["unarmed-tag"],
      // No dispatchSpec — the state between the walk's two writes.
    });

    expect(await claim(agent)).toMatchObject({ statusCode: 204 });
  });

  it("refuses a claim presenting another agent's token", async () => {
    const owner = await register("integration-owner", ["node:agent"]);
    const other = await register("integration-other", ["node:agent"]);

    const res = await server.inject({
      method: "POST",
      url: `/api/cluster-agents/${owner.id}/claim`,
      headers: { authorization: `Bearer ${other.token}` },
    });

    expect(res.statusCode).toBe(403);
  });

  it("refuses registration without the pre-shared token", async () => {
    const res = await server.inject({
      method: "POST",
      url: "/api/cluster-agents/register",
      headers: { authorization: "Bearer not-the-registration-token" },
      payload: { name: "integration-impostor", tags: [] },
    });

    expect(res.statusCode).toBe(401);
  });

  it("never hands one visit to two clusters", async () => {
    const first = await register("integration-race-a", ["race-tag"]);
    const second = await register("integration-race-b", ["race-tag"]);
    const { nodeRowId } = await enqueue(["race-tag"]);

    const [a, b] = await Promise.all([claim(first), claim(second)]);
    const winners = [a, b].filter(
      (r) => r.statusCode === 200 && r.body?.node_row_id === nodeRowId,
    );

    expect(winners).toHaveLength(1);
  });
});
