import { describe, it, expect } from "vitest";
import Hapi from "@hapi/hapi";
import { spendWindowRoute } from "./spend-window.js";

const NOW = new Date("2026-09-02T12:00:00Z");

async function serverWith() {
  const server = Hapi.server();

  server.auth.scheme("stub", () => ({
    authenticate: (_request, h: any) => h.authenticated({ credentials: {} }),
  }));
  server.auth.strategy("bearer-scope", "stub");
  server.auth.default("bearer-scope");
  server.route(
    spendWindowRoute(() => poolWith(), {
      env: {},
      now: () => NOW,
      floor: null,
    }),
  );

  return server;
}

function poolWith() {
  return {
    query: async (sql: string) => {
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

describe("Spend Window billing mode (acceptance)", () => {
  it("splits by recorded billing_mode directly instead of inferring from cluster", async () => {
    const server = await serverWith();

    const res = await server.inject({
      method: "GET",
      url: "/api/analytics/spend-window?since=30d",
    });

    expect(res.statusCode).toBe(200);
    const body = JSON.parse(res.payload);

    expect(body.llm.by_billing_mode).toContainEqual({
      mode: "subscription",
      calls: 40,
      cost_usd: 8,
    });
  });
});
