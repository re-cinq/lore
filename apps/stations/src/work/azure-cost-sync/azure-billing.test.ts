import { describe, it, expect } from "vitest";
import {
  buildCostQuery,
  buildTokenRequest,
  parseCostQueryResponse,
  readAzureCostConfig,
} from "./azure-billing.js";

const FULL_ENV = {
  LORE_AZURE_COST_SCOPE: "/subscriptions/0000-1111",
  AZURE_CLIENT_ID: "client-1",
  AZURE_TENANT_ID: "tenant-1",
  AZURE_FEDERATED_TOKEN_FILE:
    "/var/run/secrets/azure/tokens/azure-identity-token",
};

describe("readAzureCostConfig", () => {
  it("returns a skip naming the scope variable when LORE_AZURE_COST_SCOPE is unset", () => {
    expect(
      readAzureCostConfig({ ...FULL_ENV, LORE_AZURE_COST_SCOPE: "" }),
    ).toEqual({
      skip: "LORE_AZURE_COST_SCOPE not set; skipping Azure cost sync",
    });
  });

  it("returns a skip naming the Workload Identity variables when they are unset", () => {
    expect(
      readAzureCostConfig({
        LORE_AZURE_COST_SCOPE: "/subscriptions/0000-1111",
      }),
    ).toEqual({
      skip: "AZURE_CLIENT_ID / AZURE_TENANT_ID / AZURE_FEDERATED_TOKEN_FILE not set (Workload Identity); skipping Azure cost sync",
    });
  });

  it("returns the scope with its slashes trimmed and the identity settings when all are set", () => {
    expect(
      readAzureCostConfig({
        ...FULL_ENV,
        LORE_AZURE_COST_SCOPE:
          "/subscriptions/0000-1111/resourceGroups/lore-rg/",
      }),
    ).toEqual({
      scope: "subscriptions/0000-1111/resourceGroups/lore-rg",
      clientId: "client-1",
      tenantId: "tenant-1",
      tokenFile: "/var/run/secrets/azure/tokens/azure-identity-token",
    });
  });
});

describe("buildTokenRequest", () => {
  it("builds the federated client-credentials form for the management scope", () => {
    const request = buildTokenRequest(
      { clientId: "client-1", tenantId: "tenant-1" },
      "signed.jwt",
    );

    expect(request.url).toBe(
      "https://login.microsoftonline.com/tenant-1/oauth2/v2.0/token",
    );
    expect(Object.fromEntries(new URLSearchParams(request.body))).toEqual({
      client_id: "client-1",
      scope: "https://management.azure.com/.default",
      grant_type: "client_credentials",
      client_assertion_type:
        "urn:ietf:params:oauth:client-assertion-type:jwt-bearer",
      client_assertion: "signed.jwt",
    });
  });
});

describe("buildCostQuery", () => {
  it("asks for daily USD cost grouped by ServiceName over the given period", () => {
    expect(
      buildCostQuery("2026-10-19T00:00:00.000Z", "2026-11-18T09:00:00.000Z"),
    ).toEqual({
      type: "ActualCost",
      timeframe: "Custom",
      timePeriod: {
        from: "2026-10-19T00:00:00.000Z",
        to: "2026-11-18T09:00:00.000Z",
      },
      dataset: {
        granularity: "Daily",
        aggregation: { totalCost: { name: "PreTaxCostUSD", function: "Sum" } },
        grouping: [{ type: "Dimension", name: "ServiceName" }],
      },
    });
  });
});

describe("parseCostQueryResponse", () => {
  const columns = [
    { name: "PreTaxCostUSD", type: "Number" },
    { name: "UsageDate", type: "Number" },
    { name: "ServiceName", type: "String" },
    { name: "Currency", type: "String" },
  ];

  it("maps yyyymmdd usage dates and service names to provider azure rows with no credits", () => {
    expect(
      parseCostQueryResponse({
        properties: {
          columns,
          rows: [
            [12.5, 20261101, "Storage", "USD"],
            [3, 20261102, "Virtual Machines", "USD"],
          ],
        },
      }),
    ).toEqual({
      rows: [
        {
          provider: "azure",
          bucketDate: "2026-11-01",
          service: "Storage",
          costUsd: 12.5,
          creditsUsd: 0,
        },
        {
          provider: "azure",
          bucketDate: "2026-11-02",
          service: "Virtual Machines",
          costUsd: 3,
          creditsUsd: 0,
        },
      ],
      nextLink: null,
    });
  });

  it("reads columns by name when Azure returns them in another order", () => {
    expect(
      parseCostQueryResponse({
        properties: {
          columns: [columns[2], columns[1], columns[0]],
          rows: [["Storage", 20261101, 4]],
        },
      }).rows,
    ).toMatchObject([
      { bucketDate: "2026-11-01", service: "Storage", costUsd: 4 },
    ]);
  });

  it("sums rows that share a day and service", () => {
    expect(
      parseCostQueryResponse({
        properties: {
          columns,
          rows: [
            [1.25, 20261101, "Storage", "USD"],
            [2, 20261101, "Storage", "USD"],
          ],
        },
      }).rows,
    ).toMatchObject([{ service: "Storage", costUsd: 3.25 }]);
  });

  it("returns the nextLink when Azure paginates", () => {
    expect(
      parseCostQueryResponse({
        properties: { columns, rows: [], nextLink: "https://next/page2" },
      }),
    ).toEqual({ rows: [], nextLink: "https://next/page2" });
  });

  it("rejects a response without the PreTaxCostUSD column", () => {
    expect(() =>
      parseCostQueryResponse({
        properties: { columns: [columns[1], columns[2]], rows: [] },
      }),
    ).toThrow("Azure Cost Management response has no PreTaxCostUSD column");
  });
});
