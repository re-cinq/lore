import { describe, it, expect } from "vitest";
import Hapi from "@hapi/hapi";
import { spendWindowRoute } from "./spend-window.js";

const NOW = new Date("2026-09-02T12:00:00Z");

function poolWith(rows: unknown[][]) {
  let call = 0;
  return {
    query: async (sql: string) => {
      // Simulate DB queries:
      // When querying TOTALS, return some calls.
      if (sql.includes("COUNT(*)") && !sql.includes("GROUP BY")) {
        return {
          rows: [
            {
              calls: 50,
              total_usd: 10,
              input_tokens: 0,
              output_tokens: 0,
              cache_read_tokens: 0,
              cache_write_tokens: 0,
            },
          ],
        };
      }
      // When a new BY_BILLING_MODE query is added, return the precise recorded split.
      if (sql.includes("billing_mode")) {
        return {
          rows: [
            { mode: "subscription", calls: 40, cost_usd: 8 },
            { mode: "api_key", calls: 10, cost_usd: 2 },
          ],
        };
      }
      return { rows: [] };
    },
  } as never;
}

async function serverWith(rows: unknown[][]) {
  const server = Hapi.server();
  server.auth.scheme("stub", () => ({
    authenticate: (_request, h: any) => h.authenticated({ credentials: {} }),
  }));
  server.auth.strategy("bearer-scope", "stub");
  server.auth.default("bearer-scope");
  server.route(
    spendWindowRoute(() => poolWith(rows), {
      env: {},
      now: () => NOW,
      floor: null,
    }),
  );
  return server;
}

describe("Spend Window billing mode (acceptance)", () => {
  it("splits by recorded billing_mode directly instead of inferring from cluster", async () => {
    const server = await serverWith([]);

    const res = await server.inject({
      method: "GET",
      url: "/api/analytics/spend-window?since=30d",
    });

    expect(res.statusCode).toBe(200);
    const body = JSON.parse(res.payload);

    // The current API infers 100% of pipeline.llm_calls as 'api_key' because it expects the DB
    // lacks billing_mode and falls back to cluster logic.
    // It should instead pass through the true 'subscription' calls recorded in the database.
    expect(body.llm.by_billing_mode).toContainEqual({
      mode: "subscription",
      calls: 40,
      cost_usd: 8,
    });
  });
});
