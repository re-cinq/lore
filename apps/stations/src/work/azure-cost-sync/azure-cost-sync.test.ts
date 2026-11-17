import { describe, it, expect } from "vitest";
import { InMemoryGcpCost } from "@re-cinq/lore-shared/project/cost/cost-memory.js";
import { azureCostSyncJob } from "./azure-cost-sync.js";

const ENV = {
  LORE_AZURE_COST_SCOPE: "/subscriptions/0000-1111",
  AZURE_CLIENT_ID: "client-1",
  AZURE_TENANT_ID: "tenant-1",
  AZURE_FEDERATED_TOKEN_FILE: "/token",
};
const NOW = new Date("2026-11-18T09:00:00Z");

interface Call {
  url: string;
  method: string;
  body: string;
  authorization: string | null;
}

function fakeAzure(pages: unknown[]) {
  const calls: Call[] = [];
  const queue = [...pages];
  const fetchFn: typeof fetch = async (input, init) => {
    const url = String(input);

    calls.push({
      url,
      method: String(init?.method),
      body: String(init?.body),
      authorization: new Headers(init?.headers).get("Authorization"),
    });

    return Response.json(
      url.includes("login.microsoftonline.com")
        ? { access_token: "arm-token" }
        : queue.shift(),
    );
  };

  return { calls, fetchFn };
}

const columns = [
  { name: "PreTaxCostUSD", type: "Number" },
  { name: "UsageDate", type: "Number" },
  { name: "ServiceName", type: "String" },
];

async function syncTwoPages() {
  const costs = new InMemoryGcpCost();
  const { calls, fetchFn } = fakeAzure([
    {
      properties: {
        columns,
        rows: [[12.5, 20261101, "Storage"]],
        nextLink: "https://management.azure.com/next-page",
      },
    },
    { properties: { columns, rows: [[3, 20261101, "Virtual Machines"]] } },
  ]);
  const summary = await azureCostSyncJob(costs, {
    env: ENV,
    fetchFn,
    readFile: async () => "federated.jwt",
    now: NOW,
  });

  return { summary, costs, calls };
}

describe("azureCostSyncJob", () => {
  it("returns a skip summary without calling Azure when the scope is unset", async () => {
    const { calls, fetchFn } = fakeAzure([]);

    expect(
      await azureCostSyncJob(new InMemoryGcpCost(), {
        env: {},
        fetchFn,
        readFile: async () => "jwt",
        now: NOW,
      }),
    ).toMatch(/LORE_AZURE_COST_SCOPE not set; skipping/);
    expect(calls).toEqual([]);
  });

  it("upserts the rows of every page as azure rows and sums them in its summary", async () => {
    const { summary, costs } = await syncTwoPages();

    expect(summary).toBe(
      "Synced 2 day/service rows from subscriptions/0000-1111 over 31d ($15.50 billed)",
    );
    expect(costs.rows).toEqual([
      {
        provider: "azure",
        bucketDate: "2026-11-01",
        service: "Storage",
        costUsd: 12.5,
        creditsUsd: 0,
      },
      {
        provider: "azure",
        bucketDate: "2026-11-01",
        service: "Virtual Machines",
        costUsd: 3,
        creditsUsd: 0,
      },
    ]);
  });

  it("exchanges the federated token, then posts the query to the scope and to the nextLink with the bearer", async () => {
    const { calls } = await syncTwoPages();

    expect(
      calls.map(({ url, method, authorization }) => ({
        url,
        method,
        authorization,
      })),
    ).toEqual([
      {
        url: "https://login.microsoftonline.com/tenant-1/oauth2/v2.0/token",
        method: "POST",
        authorization: null,
      },
      {
        url: "https://management.azure.com/subscriptions/0000-1111/providers/Microsoft.CostManagement/query?api-version=2023-11-01",
        method: "POST",
        authorization: "Bearer arm-token",
      },
      {
        url: "https://management.azure.com/next-page",
        method: "POST",
        authorization: "Bearer arm-token",
      },
    ]);
    expect(new URLSearchParams(calls[0]?.body).get("client_assertion")).toBe(
      "federated.jwt",
    );
  });

  it("queries the 31 days ending now", async () => {
    const { calls } = await syncTwoPages();

    expect(JSON.parse(calls[1]?.body ?? "{}").timePeriod).toEqual({
      from: "2026-10-19T00:00:00.000Z",
      to: "2026-11-18T09:00:00.000Z",
    });
  });

  it("throws with the status and body when Cost Management answers 403", async () => {
    const fetchFn: typeof fetch = async (input) =>
      String(input).includes("login.microsoftonline.com")
        ? Response.json({ access_token: "arm-token" })
        : new Response("AuthorizationFailed", { status: 403 });

    await expect(
      azureCostSyncJob(new InMemoryGcpCost(), {
        env: ENV,
        fetchFn,
        readFile: async () => "jwt",
        now: NOW,
      }),
    ).rejects.toThrow(
      new Error(
        "Azure Cost Management query returned 403: AuthorizationFailed",
      ),
    );
  });
});
