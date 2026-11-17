import { enforceTrue } from "@re-cinq/lore-shared/lib/enforce.js";
import type { GcpCostDailyRow } from "@re-cinq/lore-shared/project/cost/cost-port.js";
import { z } from "zod";

// The pure half of the Azure cost sync: whether the install is configured, the token exchange and query bodies, and the parse of Cost Management's positional response into the same day/service rows the GCP sync writes.

export const ARM_BASE = "https://management.azure.com";
export const COST_API_VERSION = "2023-11-01";

export interface AzureCostConfig {
  /** `subscriptions/<id>` or `subscriptions/<id>/resourceGroups/<name>`, without the surrounding slashes. */
  scope: string;
  clientId: string;
  tenantId: string;
  tokenFile: string;
}

export type AzureCostConfigDecision = AzureCostConfig | { skip: string };

// Skips (never fails) on states only a person can change: no scope named, or the pod carries no Workload Identity. The identity variables are the ones the AKS Workload Identity webhook injects into a labelled pod.
export function readAzureCostConfig(
  env: NodeJS.ProcessEnv,
): AzureCostConfigDecision {
  const scope = env.LORE_AZURE_COST_SCOPE?.replace(/^\/+|\/+$/g, "");

  if (!scope) {
    return {
      skip: "LORE_AZURE_COST_SCOPE not set; skipping Azure cost sync",
    };
  }

  const clientId = env.AZURE_CLIENT_ID;
  const tenantId = env.AZURE_TENANT_ID;
  const tokenFile = env.AZURE_FEDERATED_TOKEN_FILE;

  if (!clientId || !tenantId || !tokenFile) {
    return {
      skip: "AZURE_CLIENT_ID / AZURE_TENANT_ID / AZURE_FEDERATED_TOKEN_FILE not set (Workload Identity); skipping Azure cost sync",
    };
  }

  return { scope, clientId, tenantId, tokenFile };
}

/** The Entra ID token request that trades the pod's projected service account token for an Azure Resource Manager token: a client-credentials grant whose secret is that federated JWT, so nothing long-lived is configured. */
export function buildTokenRequest(
  identity: Pick<AzureCostConfig, "clientId" | "tenantId">,
  federatedToken: string,
): { url: string; body: string } {
  return {
    url: `https://login.microsoftonline.com/${identity.tenantId}/oauth2/v2.0/token`,
    body: new URLSearchParams({
      client_id: identity.clientId,
      scope: `${ARM_BASE}/.default`,
      grant_type: "client_credentials",
      client_assertion_type:
        "urn:ietf:params:oauth:client-assertion-type:jwt-bearer",
      client_assertion: federatedToken,
    }).toString(),
  };
}

/** Daily actual cost in USD per service over a custom period. `PreTaxCostUSD` rather than `PreTaxCost` so the stored `cost_usd` is USD even on an account billed in another currency. */
export function buildCostQuery(fromIso: string, toIso: string) {
  return {
    type: "ActualCost",
    timeframe: "Custom",
    timePeriod: { from: fromIso, to: toIso },
    dataset: {
      granularity: "Daily",
      aggregation: { totalCost: { name: "PreTaxCostUSD", function: "Sum" } },
      grouping: [{ type: "Dimension", name: "ServiceName" }],
    },
  };
}

const CostQueryResponse = z.object({
  properties: z.object({
    columns: z.array(z.object({ name: z.string() })),
    rows: z.array(z.array(z.union([z.string(), z.number(), z.null()]))),
    nextLink: z.string().nullish(),
  }),
});

export interface ParsedCostPage {
  rows: GcpCostDailyRow[];
  nextLink: string | null;
}

type CostCell = string | number | null | undefined;

interface ColumnPositions {
  cost: number;
  date: number;
  service: number;
}

// Columns are read by name: the order Cost Management returns them in is not part of its contract. Rows sharing a day and service are summed so the upsert never sees one key twice in a page.
export function parseCostQueryResponse(raw: unknown): ParsedCostPage {
  const { columns, rows, nextLink } = CostQueryResponse.parse(raw).properties;
  const at = columnPositions(columns.map((column) => column.name));

  return {
    rows: sumPerDayAndService(rows.map((row) => toCostRow(row, at))),
    nextLink: nextLink ?? null,
  };
}

function columnPositions(names: string[]): ColumnPositions {
  const positions = {
    cost: names.indexOf("PreTaxCostUSD"),
    date: names.indexOf("UsageDate"),
    service: names.indexOf("ServiceName"),
  };

  enforceTrue(
    positions.cost !== -1,
    Error,
    "Azure Cost Management response has no PreTaxCostUSD column",
  );

  return positions;
}

function toCostRow(row: CostCell[], at: ColumnPositions): GcpCostDailyRow {
  return {
    provider: "azure",
    bucketDate: isoDay(row[at.date]),
    service: String(row[at.service] ?? ""),
    costUsd: Number(row[at.cost] ?? 0),
    creditsUsd: 0,
  };
}

function sumPerDayAndService(rows: GcpCostDailyRow[]): GcpCostDailyRow[] {
  const summed = new Map<string, GcpCostDailyRow>();

  for (const row of rows) {
    const key = `${row.bucketDate}|${row.service}`;
    const earlier = summed.get(key);

    summed.set(key, {
      ...row,
      costUsd: row.costUsd + (earlier?.costUsd ?? 0),
    });
  }

  return [...summed.values()];
}

// UsageDate arrives as the number 20261101.
function isoDay(usageDate: CostCell): string {
  const digits = String(usageDate ?? "");

  return `${digits.slice(0, 4)}-${digits.slice(4, 6)}-${digits.slice(6, 8)}`;
}
