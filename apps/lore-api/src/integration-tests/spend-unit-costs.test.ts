import { describe, it, expect, beforeAll, afterAll } from "vitest";
import type { Server } from "@hapi/hapi";
import pg from "pg";
import { buildServer } from "../app/build-server.js";
import { restoreEnv } from "./restore-env.js";

const TOKEN = "test-spend-units-token";
const REPO = "test/spend-units";
const CREATED_BY = "integration-test-spend-units";
const AT = "2026-01-10T12:00:00Z";
const WINDOW = "from=2026-01-10&to=2026-01-10";

interface Fixture {
  pool: pg.Pool;
  runIds: string[];
}

describe("the spend window's unit costs, against real Postgres", () => {
  let server: Server;
  const fx: Fixture = {
    pool: new pg.Pool({
      host: process.env.LORE_DB_HOST || "localhost",
      port: parseInt(process.env.LORE_DB_PORT || "5432"),
      database: process.env.LORE_DB_NAME || "lore_test",
      user: process.env.LORE_DB_USER || "lore",
      password: process.env.LORE_DB_PASSWORD || "test",
    }),
    runIds: [],
  };
  const prevToken = process.env.LORE_INGEST_TOKEN;
  let body: {
    llm: Record<string, unknown>;
    unit_costs: Record<string, unknown>;
  };

  beforeAll(async () => {
    process.env.LORE_INGEST_TOKEN = TOKEN;
    server = buildServer(() => fx.pool);
    await seedTickets(fx);
    await seedReviews(fx);

    const res = await server.inject({
      method: "GET",
      url: `/api/analytics/spend-window?${WINDOW}`,
      headers: { authorization: `Bearer ${TOKEN}` },
    });

    body = JSON.parse(res.payload);
  });

  afterAll(async () => {
    await fx.pool.query(
      "DELETE FROM pipeline.llm_calls WHERE assembly_line_id = ANY($1::uuid[])",
      [fx.runIds],
    );
    await fx.pool.query(
      "DELETE FROM pipeline.assembly_runs WHERE id = ANY($1::uuid[])",
      [fx.runIds],
    );
    await fx.pool.query("DELETE FROM pipeline.tasks WHERE created_by = $1", [
      CREATED_BY,
    ]);
    await server.stop();
    await fx.pool.end();
    restoreEnv("LORE_INGEST_TOKEN", prevToken);
  });

  it("sums 3 tickets to 8 USD with a 1.50 USD median, keyed by issue url, loop branch, then description", () => {
    expect(body.unit_costs.tickets).toEqual({
      count: 3,
      total_usd: 8,
      avg_usd: expect.closeTo(2.6667, 3),
      median_usd: 1.5,
      most: [
        {
          label: "test/spend-units#11",
          url: "https://github.com/test/spend-units/issues/11",
          runs: 2,
          cost_usd: 6,
        },
        { label: "Old ticket text", url: null, runs: 1, cost_usd: 1.5 },
        {
          label: "test/spend-units#12",
          url: "https://github.com/test/spend-units/issues/12",
          runs: 1,
          cost_usd: 0.5,
        },
      ],
      least: [
        {
          label: "test/spend-units#12",
          url: "https://github.com/test/spend-units/issues/12",
          runs: 1,
          cost_usd: 0.5,
        },
        { label: "Old ticket text", url: null, runs: 1, cost_usd: 1.5 },
        {
          label: "test/spend-units#11",
          url: "https://github.com/test/spend-units/issues/11",
          runs: 2,
          cost_usd: 6,
        },
      ],
    });
  });

  it("puts review, recheck and reply of PR 7 on one 1.50 USD PR beside PR 8 at 0.40 USD", () => {
    expect(body.unit_costs.reviews).toMatchObject({
      per_pr: {
        count: 2,
        total_usd: expect.closeTo(1.9, 6),
        median_usd: expect.closeTo(0.95, 6),
        most: [
          {
            label: "test/spend-units#7",
            url: "https://github.com/test/spend-units/pull/7",
            runs: 3,
            cost_usd: expect.closeTo(1.5, 6),
          },
          {
            label: "test/spend-units#8",
            url: "https://github.com/test/spend-units/pull/8",
            runs: 1,
            cost_usd: expect.closeTo(0.4, 6),
          },
        ],
      },
      by_line: [
        {
          blueprint: "code-review",
          runs: 2,
          total_usd: expect.closeTo(1.6, 6),
          avg_usd: expect.closeTo(0.8, 6),
        },
        {
          blueprint: "code-review-recheck",
          runs: 1,
          total_usd: expect.closeTo(0.2, 6),
          avg_usd: expect.closeTo(0.2, 6),
        },
        {
          blueprint: "code-review-reply",
          runs: 1,
          total_usd: expect.closeTo(0.1, 6),
          avg_usd: expect.closeTo(0.1, 6),
        },
      ],
      by_model: [
        {
          model: "gemini-3.1-pro-preview",
          calls: 3,
          cost_usd: expect.closeTo(1.8, 6),
        },
        {
          model: "claude-haiku-4-5",
          calls: 1,
          cost_usd: expect.closeTo(0.1, 6),
        },
      ],
    });
  });

  it("counts tdd-round as 2 visits at 2 USD each on two models, per assembly line", () => {
    expect(body.unit_costs.nodes).toEqual([
      {
        blueprint: "code-review",
        node_id: "review",
        visits: 1,
        total_usd: expect.closeTo(0.4, 6),
        per_visit_usd: expect.closeTo(0.4, 6),
        models: ["gemini-3.1-pro-preview"],
      },
      {
        blueprint: "implementation-loop",
        node_id: "tdd-round",
        visits: 2,
        total_usd: 4,
        per_visit_usd: 2,
        models: ["claude-opus-4-7", "claude-sonnet-4-6"],
      },
    ]);
  });

  it("totals 9 calls' 8100 cache-read and 360 cache-write tokens", () => {
    expect(body.llm).toMatchObject({
      cache_read_tokens: 8100,
      cache_write_tokens: 360,
    });
  });
});

async function seedTickets(fx: Fixture): Promise<void> {
  const pool = fx.pool;
  const issued = await insertTask(
    pool,
    "Issue eleven",
    "https://github.com/test/spend-units/issues/11",
  );
  const loop = { blueprint: "implementation-loop", branch: null, args: {} };
  const first = await insertRun(fx, { ...loop, taskId: issued });
  const tdd1 = await insertVisit(pool, first, ["tdd-round", 1]);
  const tdd2 = await insertVisit(pool, first, ["tdd-round", 2]);

  await insertCall(pool, {
    runId: first,
    model: "claude-opus-4-7",
    costUsd: 3,
    stationRunId: tdd1,
  });
  await insertCall(pool, {
    runId: first,
    model: "claude-sonnet-4-6",
    costUsd: 1,
    stationRunId: tdd2,
  });
  await seedLaterTickets(fx, issued);
}

async function seedLaterTickets(fx: Fixture, issued: string): Promise<void> {
  const loop = { blueprint: "implementation-loop", args: {} };
  const second = await insertRun(fx, { ...loop, taskId: issued, branch: null });
  const branchOnly = await insertRun(fx, {
    ...loop,
    taskId: null,
    branch: "lore/implementation-loop/issue-12",
  });
  const described = await insertTask(fx.pool, "Old ticket text", null);
  const old = await insertRun(fx, { ...loop, taskId: described, branch: null });

  await insertCall(fx.pool, {
    runId: second,
    model: "claude-opus-4-7",
    costUsd: 2,
  });
  await insertCall(fx.pool, {
    runId: branchOnly,
    model: "claude-opus-4-7",
    costUsd: 0.5,
  });
  await insertCall(fx.pool, {
    runId: old,
    model: "claude-opus-4-7",
    costUsd: 1.5,
  });
}

async function seedReviews(fx: Fixture): Promise<void> {
  const pr = (blueprint: string, n: number) =>
    insertRun(fx, {
      blueprint,
      taskId: null,
      branch: null,
      args: { pr_number: n },
    });
  const review7 = await pr("code-review", 7);
  const recheck7 = await pr("code-review-recheck", 7);
  const reply7 = await pr("code-review-reply", 7);
  const review8 = await pr("code-review", 8);
  const visit = await insertVisit(fx.pool, review8, ["review", 1]);
  const gemini = "gemini-3.1-pro-preview";

  await insertCall(fx.pool, { runId: review7, model: gemini, costUsd: 1.2 });
  await insertCall(fx.pool, { runId: recheck7, model: gemini, costUsd: 0.2 });
  await insertCall(fx.pool, {
    runId: reply7,
    model: "claude-haiku-4-5",
    costUsd: 0.1,
  });
  await insertCall(fx.pool, {
    runId: review8,
    model: gemini,
    costUsd: 0.4,
    stationRunId: visit,
  });
}

interface RunSpec {
  blueprint: string;
  taskId: string | null;
  branch: string | null;
  args: Record<string, unknown>;
}

interface CallSpec {
  runId: string;
  model: string;
  costUsd: number;
  stationRunId?: string;
}

async function insertTask(
  pool: pg.Pool,
  description: string,
  issueUrl: string | null,
): Promise<string> {
  const { rows } = await pool.query<{ id: string }>(
    `INSERT INTO pipeline.tasks (description, task_type, target_repo, created_by, issue_url)
     VALUES ($1, 'implementation-loop', $2, $3, $4) RETURNING id`,
    [description, REPO, CREATED_BY, issueUrl],
  );

  return rows[0].id;
}

async function insertRun(fx: Fixture, run: RunSpec): Promise<string> {
  const { rows } = await fx.pool.query<{ id: string }>(
    `INSERT INTO pipeline.assembly_runs (blueprint_name, repo, task_id, branch, args, status)
     VALUES ($1, $2, $3, $4, $5::jsonb, 'succeeded') RETURNING id`,
    [run.blueprint, REPO, run.taskId, run.branch, JSON.stringify(run.args)],
  );

  fx.runIds.push(rows[0].id);

  return rows[0].id;
}

async function insertVisit(
  pool: pg.Pool,
  runId: string,
  [nodeId, iteration]: [string, number],
): Promise<string> {
  const { rows } = await pool.query<{ station_run_id: string }>(
    `INSERT INTO pipeline.station_runs (assembly_run_id, node_id, iteration, outcome)
     VALUES ($1, $2, $3, 'success') RETURNING station_run_id`,
    [runId, nodeId, iteration],
  );

  return rows[0].station_run_id;
}

async function insertCall(pool: pg.Pool, call: CallSpec): Promise<void> {
  await pool.query(
    `INSERT INTO pipeline.llm_calls
       (assembly_line_id, station_run_id, model, input_tokens, output_tokens,
        cache_read_tokens, cache_write_tokens, cost_usd, duration_ms, created_at)
     VALUES ($1, $2, $3, 10, 20, 900, 40, $4, 100, $5)`,
    [call.runId, call.stationRunId ?? null, call.model, call.costUsd, AT],
  );
}
