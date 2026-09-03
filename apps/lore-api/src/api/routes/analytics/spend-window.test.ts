import { describe, it, expect } from "vitest";
import Hapi from "@hapi/hapi";
import { spendWindowRoute, type SpendWindowDeps } from "./spend-window.js";

const NOW = new Date("2026-09-02T12:00:00Z");

const undefinedTable = () =>
  Object.assign(new Error("no such table"), { code: "42P01" });

interface Issued {
  sql: string;
  params: unknown[];
}

function poolWith(
  rows: unknown[][],
  issued: Issued[] = [],
  rejectWhen: (sql: string) => boolean = () => false,
) {
  let call = 0;

  return {
    query: async (sql: string, params: unknown[] = []) => {
      issued.push({ sql, params });

      if (rejectWhen(sql)) {
        call++;

        return Promise.reject(undefinedTable());
      }

      return { rows: rows[call++] ?? [] };
    },
  } as never;
}

async function serverWith(
  rows: unknown[][],
  deps: Partial<SpendWindowDeps> = {},
  issued: Issued[] = [],
  rejectWhen?: (sql: string) => boolean,
) {
  const server = Hapi.server();

  server.auth.scheme("stub", () => ({
    authenticate: (_request, h) => h.authenticated({ credentials: {} }),
  }));
  server.auth.strategy("bearer-scope", "stub");
  server.auth.default("bearer-scope");
  server.route(
    spendWindowRoute(() => poolWith(rows, issued, rejectWhen), {
      livePods: async () => [],
      env: {},
      now: () => NOW,
      ...deps,
    }),
  );

  return server;
}

const BASE_ROWS: unknown[][] = [
  [{ calls: 42, usd: 82.5, input_tokens: 12345, output_tokens: 735021 }],
  [{ blueprint: "implementation-loop", runs: 15, usd: 27.47 }],
  [{ repo: "re-cinq/lore", usd: 80.1 }],
  [
    {
      model: "claude-sonnet-4-6",
      calls: 50,
      cost_usd: 31.73,
      input_tokens: 3372,
      output_tokens: 597948,
    },
  ],
  [{ kind: "Code review / detection line", calls: 78, cost_usd: 37.68 }],
  [{ bucket_date: "2026-09-01", calls: 32, cost_usd: 14.24 }],
  [{ task_type: "implementation", tasks: 30, cost_usd: 222.22 }],
  [{ cluster: null, calls: 40, cost_usd: 20 }],
  [
    {
      billed_usd: 1234.5,
      input_tokens: 1000000,
      output_tokens: 50000,
      as_of: "2026-09-02T10:00:00.000Z",
      billed_through: "2026-09-01",
    },
  ],
  [
    {
      model: "claude-opus-4",
      cost_usd: 900.25,
      input_tokens: 1000000,
      output_tokens: 50000,
    },
  ],
  [{ bucket_date: "2026-09-01", cost_usd: 400.1 }],
  [{ cost_usd: 1.95, days: 1 }],
  [
    {
      billed_usd: 210.4,
      as_of: "2026-09-02T08:00:00.000Z",
      billed_through: "2026-09-01",
    },
  ],
  [{ service: "Kubernetes Engine", cost_usd: 180.2 }],
  [{ bucket_date: "2026-09-01", cost_usd: 30.5 }],
  [{ blueprint: "implementation-loop", pods: 9, hours: 6.5 }],
  [{ ledger_total_usd: 500, anchored_at: "2026-08-01T00:00:00Z" }],
  [{ billed_usd: 300, billed_through: "2026-09-01" }],
  [{ cost_usd: 12.5 }],
];

const get = (server: Hapi.Server, url = "/api/analytics/spend-window") =>
  server.inject({ method: "GET", url });

describe("GET /api/analytics/spend-window", () => {
  it("windows the metered llm spend and prices pod-hours at the assumed profile", async () => {
    const server = await serverWith(BASE_ROWS);
    const res = await get(
      server,
      "/api/analytics/spend-window?from=2026-09-01&to=2026-09-02",
    );
    const body = JSON.parse(res.payload);

    expect(res.statusCode).toBe(200);
    expect(body.interval).toEqual({ from: "2026-09-01", to: "2026-09-02" });
    expect(body.llm).toMatchObject({
      total_usd: 82.5,
      calls: 42,
      input_tokens: 12345,
      output_tokens: 735021,
    });
    expect(body.llm.by_blueprint[0]).toEqual({
      blueprint: "implementation-loop",
      runs: 15,
      usd: 27.47,
    });
    expect(body.compute.pod_hours[0]).toEqual({
      blueprint: "implementation-loop",
      pods: 9,
      hours: 6.5,
      est_usd: 0.22,
    });
    expect(body.compute.est_total_usd).toBe(0.22);
    expect(body.compute.assumed_profile).toEqual({ cpu: "1", memory: "4Gi" });
  });

  it("carries every interval-scoped breakdown the merged spend page renders", async () => {
    const body = JSON.parse((await get(await serverWith(BASE_ROWS))).payload);

    expect(body.llm.by_model[0]).toMatchObject({
      model: "claude-sonnet-4-6",
      calls: 50,
      cost_usd: 31.73,
    });
    expect(body.llm.by_kind[0]).toMatchObject({
      kind: "Code review / detection line",
      cost_usd: 37.68,
    });
    expect(body.llm.daily[0]).toEqual({
      bucket_date: "2026-09-01",
      calls: 32,
      cost_usd: 14.24,
    });
    expect(body.llm.by_task_type[0]).toEqual({
      task_type: "implementation",
      tasks: 30,
      cost_usd: 222.22,
    });
    expect(body.llm.by_cluster[0]).toEqual({
      cluster: null,
      calls: 40,
      cost_usd: 20,
    });
    expect(body.billed).toMatchObject({
      available: true,
      total_usd: 1234.5,
      billed_through: "2026-09-01",
      unbilled_usd: 1.95,
      unbilled_days: 1,
    });
    expect(body.billed.by_model[0]).toMatchObject({ model: "claude-opus-4" });
    expect(body.billed.daily[0]).toEqual({
      bucket_date: "2026-09-01",
      cost_usd: 400.1,
    });
    expect(body.gcp).toMatchObject({
      available: true,
      total_usd: 210.4,
      billed_through: "2026-09-01",
    });
    expect(body.gcp.by_service[0]).toEqual({
      service: "Kubernetes Engine",
      cost_usd: 180.2,
    });
    expect(body.gcp.daily[0]).toEqual({
      bucket_date: "2026-09-01",
      cost_usd: 30.5,
    });
  });

  it("sums the GCP figures net of credits, since the invoice charges the net", async () => {
    const issued: Issued[] = [];

    await get(await serverWith(BASE_ROWS, {}, issued));

    const gcpReads = issued.filter(({ sql }) =>
      sql.includes("pipeline.gcp_cost_daily"),
    );

    expect(gcpReads).toHaveLength(3);

    for (const { sql } of gcpReads) {
      expect(sql).toContain("cost_usd + credits_usd");
    }
  });

  it("reports the GCP half unavailable when the billing sync has never run", async () => {
    const rows = [...BASE_ROWS];

    rows[12] = [{ billed_usd: 0, as_of: null, billed_through: null }];
    const body = JSON.parse((await get(await serverWith(rows))).payload);

    expect(body.gcp).toMatchObject({
      available: false,
      as_of: null,
      billed_through: null,
    });
  });

  it("degrades to unavailable GCP figures when gcp_cost_daily (migration 0060) is absent, still rendering the metered figures", async () => {
    const server = await serverWith(BASE_ROWS, {}, [], (sql) =>
      sql.includes("pipeline.gcp_cost_daily"),
    );
    const res = await get(server);
    const body = JSON.parse(res.payload);

    expect(res.statusCode).toBe(200);
    expect(body.gcp).toMatchObject({
      available: false,
      total_usd: 0,
      by_service: [],
      daily: [],
    });
    expect(body.llm.total_usd).toBe(82.5);
  });

  it("scopes every metered and billed read to the interval, except the ledger and the budget", async () => {
    const issued: Issued[] = [];
    const server = await serverWith(BASE_ROWS, {}, issued);

    await get(
      server,
      "/api/analytics/spend-window?from=2026-09-01&to=2026-09-02",
    );

    const windowed = issued.filter(
      ({ sql, params }) =>
        !sql.includes("pipeline.credit_ledger") &&
        !params.includes("2026-08-01T00:00:00Z"),
    );

    for (const { params } of windowed) {
      expect(params[0]).toMatch(/^2026-09-01/);
      expect(String(params[1])).toMatch(/^2026-09-0[23]/);
    }
  });

  it("prices each live pod from its ACTUAL requests and sums the burn rate", async () => {
    const server = await serverWith(BASE_ROWS, {
      livePods: async () => [
        {
          name: "agent-job-run1-tdd-round-abc",
          phase: "Running",
          startedAt: "2026-09-02T11:00:00.000Z",
          requests: { cpu: "1", memory: "16Gi" },
          labels: { "lore.re-cinq.com/station-run-id": "sr-1" },
        },
      ],
    });
    const body = JSON.parse((await get(server)).payload);
    const pod = body.compute.live_pods[0];

    expect(pod).toMatchObject({
      name: "agent-job-run1-tdd-round-abc",
      usd_per_hour: 0.07,
      usd_so_far: 0.07,
      station_run_id: "sr-1",
    });
    expect(body.compute.live_usd_per_hour).toBe(0.07);
  });

  it("defaults to the last 7 days and rejects a bad interval as a 400 naming the rule", async () => {
    const server = await serverWith(BASE_ROWS);
    const ok = await get(server);

    expect(JSON.parse(ok.payload).interval).toEqual({
      from: "2026-08-26",
      to: "2026-09-02",
    });

    const bad = await get(
      server,
      "/api/analytics/spend-window?from=2026-09-02&to=2026-09-01",
    );

    expect({ status: bad.statusCode, body: JSON.parse(bad.payload) }).toEqual({
      status: 400,
      body: { error: "from must not be after to" },
    });
  });

  it("caps a never-finished station-run row at 2 hours instead of billing it as still running (177 stale comment-triage rows once billed 8,606 pod-hours riding now())", async () => {
    const issued: Issued[] = [];
    const server = await serverWith(BASE_ROWS, {}, issued);

    await get(server);

    const podHoursSql =
      issued.find(({ sql }) => sql.includes("agent_cr_name"))?.sql ?? "";

    expect(podHoursSql).toContain("sr.started_at + interval '2 hours'");
    expect(podHoursSql).not.toMatch(/coalesce\(sr\.finished_at,\s*now\(\)\)/);
  });

  it("an unreachable cluster-agent degrades to an empty live list, never a failed page", async () => {
    const server = await serverWith(BASE_ROWS, {
      livePods: async () => {
        throw new Error("should be caught by the default deps, not reach here");
      },
    });
    const res = await get(server);

    expect(res.statusCode).toBe(200);
    expect(JSON.parse(res.payload).compute.live_pods).toEqual([]);
  });

  it("reports the billed half unavailable (not a confident zero) when the sync has never run", async () => {
    const rows = [...BASE_ROWS];

    rows[8] = [
      {
        billed_usd: 0,
        input_tokens: 0,
        output_tokens: 0,
        as_of: null,
        billed_through: null,
      },
    ];
    const body = JSON.parse((await get(await serverWith(rows))).payload);

    expect(body.billed).toMatchObject({
      available: false,
      as_of: null,
      billed_through: null,
    });
  });

  it("degrades to unavailable billed figures when anthropic_cost_daily is absent, still rendering the metered figures", async () => {
    const issued: Issued[] = [];
    const server = await serverWith(BASE_ROWS, {}, issued, (sql) =>
      sql.includes("pipeline.anthropic_cost_daily"),
    );
    const res = await get(server);
    const body = JSON.parse(res.payload);

    expect(res.statusCode).toBe(200);
    expect(body.billed).toMatchObject({
      available: false,
      total_usd: 0,
      by_model: [],
      daily: [],
    });
    expect(body.llm.total_usd).toBe(82.5);
  });

  it("bounds the unbilled read by the last billed day, and by nothing when never synced", async () => {
    const issued: Issued[] = [];

    await get(await serverWith(BASE_ROWS, {}, issued));

    const unbilled = issued.find(({ sql }) => sql.includes("$3::date"));

    expect(unbilled?.params[2]).toBe("2026-09-01");

    const neverSynced: Issued[] = [];
    const rows = [...BASE_ROWS];

    rows[8] = [];
    await get(await serverWith(rows, {}, neverSynced));

    expect(
      neverSynced.find(({ sql }) => sql.includes("$3::date"))?.params[2],
    ).toBe(null);
  });

  it("reports no budget (not a confident $0.00) when no balance has ever been recorded", async () => {
    const rows = [...BASE_ROWS];

    rows[16] = [];
    const body = JSON.parse((await get(await serverWith(rows))).payload);

    expect(body.budget).toBe(null);
  });

  it("reports no budget when the credit-ledger table has not been migrated yet", async () => {
    const server = await serverWith(BASE_ROWS, {}, [], (sql) =>
      sql.includes("pipeline.credit_ledger"),
    );
    const res = await get(server);

    expect(res.statusCode).toBe(200);
    expect(JSON.parse(res.payload).budget).toBe(null);
  });

  it("reports remaining as the ledger total minus billed and unbilled spend since the anchor", async () => {
    const body = JSON.parse((await get(await serverWith(BASE_ROWS))).payload);

    expect(body.budget).toEqual({
      ledger_total_usd: 500,
      spent_since_usd: 312.5,
      remaining_usd: 187.5,
      anchored_at: "2026-08-01T00:00:00Z",
    });
  });

  it("anchors both budget halves to the ledger entry and excludes satellite spend from the computed side", async () => {
    const issued: Issued[] = [];

    await get(await serverWith(BASE_ROWS, {}, issued));

    const anchored = issued.filter(({ params }) =>
      params.includes("2026-08-01T00:00:00Z"),
    );

    expect(anchored).toHaveLength(2);
    expect(anchored[0].sql).toContain("pipeline.anthropic_cost_daily");
    expect(anchored[1].sql).toContain("pipeline.llm_calls");
    expect(anchored[1].sql).toContain("cluster_agent_id IS NULL");
    // The two halves meet at billed_through and must not overlap: billed
    // covers up to and including it, computed starts strictly after. The third
    // param is the non-Anthropic vendor exclusion below.
    expect(anchored[1].params.slice(0, 2)).toEqual([
      "2026-08-01T00:00:00Z",
      "2026-09-01",
    ]);
  });

  it("keeps Gemini spend out of the Anthropic balance and the unbilled remainder", async () => {
    // Since 2026-09-02 the review family bills Google, not Anthropic. Counting
    // it drew the recorded credits down on money Anthropic never charged — and
    // the unbilled line under the billed card is the same arithmetic.
    const issued: Issued[] = [];

    await get(await serverWith(BASE_ROWS, {}, issued));

    const excluding = issued.filter(({ sql }) => sql.includes("NOT LIKE ALL"));

    expect(excluding).toHaveLength(2);

    for (const { sql, params } of excluding) {
      expect(sql).toContain("pipeline.llm_calls");
      expect(params.at(-1)).toContain("gemini%");
    }
  });

  it("excludes corrections from the budget anchor but not from the total", async () => {
    const issued: Issued[] = [];

    await get(await serverWith(BASE_ROWS, {}, issued));

    const sql =
      issued.find(({ sql: s }) => s.includes("pipeline.credit_ledger"))?.sql ??
      "";

    expect(sql).toContain("MIN(effective_at) FILTER (WHERE kind = 'opening')");
    expect(sql).toContain(
      "MIN(effective_at) FILTER (WHERE kind <> 'correction')",
    );
    expect(sql).toContain("COALESCE(SUM(amount_usd), 0)");
    expect(sql).not.toContain("SUM(amount_usd) FILTER");
  });

  it("groups cluster spend through station_runs (LEFT JOINs) so unclaimed rows land in the null bucket, not vanish", async () => {
    const issued: Issued[] = [];

    await get(await serverWith(BASE_ROWS, {}, issued));

    const sql =
      issued.find(({ sql: s }) => s.includes("pipeline.cluster_agents"))?.sql ??
      "";

    expect(sql).toContain("LEFT JOIN pipeline.station_runs");
    expect(sql).toContain("LEFT JOIN pipeline.cluster_agents");
    expect(sql).toContain("cluster_agent_id");
  });

  it("still renders cluster spend empty when the registry table is absent", async () => {
    const server = await serverWith(BASE_ROWS, {}, [], (sql) =>
      sql.includes("pipeline.cluster_agents"),
    );
    const res = await get(server);

    expect(res.statusCode).toBe(200);
    expect(JSON.parse(res.payload).llm.by_cluster).toEqual([]);
  });

  it("attributes run-scoped spend through llm_calls.assembly_line_id, a column deliberately NOT renamed with the run model", async () => {
    const issued: Issued[] = [];

    await get(await serverWith(BASE_ROWS, {}, issued));

    expect(
      issued.filter(({ sql }) => sql.includes("l.assembly_line_id")).length,
    ).toBeGreaterThan(0);
    expect(issued.some(({ sql }) => sql.includes("l.assembly_run_id"))).toBe(
      false,
    );
  });
});
