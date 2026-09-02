import { describe, it, expect } from "vitest";
import Hapi from "@hapi/hapi";
import { spendWindowRoute, type SpendWindowDeps } from "./spend-window.js";

const NOW = new Date("2026-09-02T12:00:00Z");

function poolWith(rows: unknown[][], issued: string[] = []) {
  let call = 0;

  return {
    query: async (sql: string) => {
      issued.push(sql);

      return { rows: rows[call++] ?? [] };
    },
  } as never;
}

async function serverWith(
  rows: unknown[][],
  deps: Partial<SpendWindowDeps> = {},
  issued: string[] = [],
) {
  const server = Hapi.server();

  server.auth.scheme("stub", () => ({
    authenticate: (_request, h) => h.authenticated({ credentials: {} }),
  }));
  server.auth.strategy("bearer-scope", "stub");
  server.auth.default("bearer-scope");
  server.route(
    spendWindowRoute(() => poolWith(rows, issued), {
      livePods: async () => [],
      env: {},
      now: () => NOW,
      ...deps,
    }),
  );

  return server;
}

const BASE_ROWS: unknown[][] = [
  [{ calls: 42, usd: 82.5 }],
  [{ blueprint: "implementation-loop", runs: 15, usd: 27.47 }],
  [{ repo: "re-cinq/lore", usd: 80.1 }],
  [{ blueprint: "implementation-loop", pods: 9, hours: 6.5 }],
];

describe("GET /api/analytics/spend-window", () => {
  it("windows the metered llm spend and prices pod-hours at the assumed profile", async () => {
    const server = await serverWith(BASE_ROWS);
    const res = await server.inject({
      method: "GET",
      url: "/api/analytics/spend-window?from=2026-09-01&to=2026-09-02",
    });
    const body = JSON.parse(res.payload);

    expect(res.statusCode).toBe(200);
    expect(body.interval).toEqual({ from: "2026-09-01", to: "2026-09-02" });
    expect(body.llm).toMatchObject({ total_usd: 82.5, calls: 42 });
    expect(body.llm.by_blueprint[0]).toEqual({
      blueprint: "implementation-loop",
      runs: 15,
      usd: 27.47,
    });
    // 6.5 pod-hours × (1 cpu × 0.022 + 4Gi × 0.003) = 6.5 × 0.034 ≈ 0.22
    expect(body.compute.pod_hours[0]).toEqual({
      blueprint: "implementation-loop",
      pods: 9,
      hours: 6.5,
      est_usd: 0.22,
    });
    expect(body.compute.est_total_usd).toBe(0.22);
    expect(body.compute.assumed_profile).toEqual({ cpu: "1", memory: "4Gi" });
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
    const res = await server.inject({
      method: "GET",
      url: "/api/analytics/spend-window",
    });
    const body = JSON.parse(res.payload);
    const pod = body.compute.live_pods[0];

    // 1 cpu × 0.022 + 16Gi × 0.003 = 0.07/h, one hour up so far.
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
    const ok = await server.inject({
      method: "GET",
      url: "/api/analytics/spend-window",
    });

    expect(JSON.parse(ok.payload).interval).toEqual({
      from: "2026-08-26",
      to: "2026-09-02",
    });

    const bad = await server.inject({
      method: "GET",
      url: "/api/analytics/spend-window?from=2026-09-02&to=2026-09-01",
    });

    expect({ status: bad.statusCode, body: JSON.parse(bad.payload) }).toEqual({
      status: 400,
      body: { error: "from must not be after to" },
    });
  });

  it("caps a never-finished station-run row at 2 hours instead of billing it as still running", async () => {
    const issued: string[] = [];
    const server = await serverWith(BASE_ROWS, {}, issued);

    await server.inject({ method: "GET", url: "/api/analytics/spend-window" });

    // The pod-hours read is the 4th query. A row whose pod died without a
    // finished_at write must be clipped to started_at + 2h — 177 stale
    // comment-triage rows once billed 8,606 pod-hours by riding now().
    const podHoursSql = issued[3];

    expect(podHoursSql).toContain("sr.started_at + interval '2 hours'");
    expect(podHoursSql).not.toMatch(/coalesce\(sr\.finished_at,\s*now\(\)\)/);
  });

  it("an unreachable cluster-agent degrades to an empty live list, never a failed page", async () => {
    const server = await serverWith(BASE_ROWS, {
      livePods: async () => {
        throw new Error("should be caught by the default deps, not reach here");
      },
    });
    // The route itself must not call livePods in a way that lets a throw
    // escape: the defaultDeps swallow, but an injected thrower proves the
    // handler guards too.
    const res = await server.inject({
      method: "GET",
      url: "/api/analytics/spend-window",
    });

    expect(res.statusCode).toBe(200);
    expect(JSON.parse(res.payload).compute.live_pods).toEqual([]);
  });
});
