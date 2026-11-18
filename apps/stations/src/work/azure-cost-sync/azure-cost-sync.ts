import { readFile } from "node:fs/promises";
import { enforceTrue } from "@re-cinq/lore-shared/lib/enforce.js";
import type {
  GcpCostDailyRow,
  GcpCostPort,
} from "@re-cinq/lore-shared/project/cost/cost-port.js";
import { billingWindowStart } from "../gcp-cost-sync/gcp-cost-sync.js";
import {
  ARM_BASE,
  COST_API_VERSION,
  buildCostQuery,
  buildTokenRequest,
  parseCostQueryResponse,
  readAzureCostConfig,
  type AzureCostConfig,
  sumPerDayAndService,
} from "./azure-billing.js";

// Same trailing window as the GCP and Anthropic syncs, for the same reason: Azure restates late usage, and a re-pulled window self-heals through the upsert.
const SYNC_WINDOW_DAYS = 31;

/** What the job touches outside itself, each replaceable by a test. */
export interface AzureCostSyncDeps {
  env: NodeJS.ProcessEnv;
  fetchFn: typeof fetch;
  readFile: (path: string) => Promise<string>;
  now: Date;
}

const PROCESS_DEPS: AzureCostSyncDeps = {
  env: process.env,
  fetchFn: fetch,
  readFile: (path) => readFile(path, "utf8"),
  now: new Date(),
};

// The daily pull: trades the pod's federated token for an ARM token, asks Cost Management for the trailing window per day and service, upserts every page. Skips (never fails) when the install is not configured for Azure.
export async function azureCostSyncJob(
  costs: GcpCostPort,
  deps: Partial<AzureCostSyncDeps> = {},
): Promise<string> {
  const io = { ...PROCESS_DEPS, now: new Date(), ...deps };
  const config = readAzureCostConfig(io.env);

  if ("skip" in config) {
    return config.skip;
  }

  const token = await fetchAccessToken(config, io);
  const rows = sumPerDayAndService(
    await queryAllPages(config.scope, token, io),
  );

  await Promise.all(rows.map((row) => costs.upsertGcpDaily(row)));

  const totalUsd = rows.reduce((sum, row) => sum + row.costUsd, 0);

  return `Synced ${rows.length} day/service rows from ${config.scope} over ${SYNC_WINDOW_DAYS}d ($${totalUsd.toFixed(2)} billed)`;
}

// Workload Identity: the webhook projects a short-lived service account token into the pod, and Entra ID accepts it as the client credential, so there is no secret to store or rotate. The file is read on every run because the kubelet rotates it.
async function fetchAccessToken(
  config: AzureCostConfig,
  io: AzureCostSyncDeps,
): Promise<string> {
  const federated = (await io.readFile(config.tokenFile)).trim();
  const res = await postTokenRequest(buildTokenRequest(config, federated), io);
  const { access_token } = (await res.json()) as { access_token?: string };

  enforceTrue(
    access_token,
    Error,
    "Entra ID token response carried no access_token",
  );

  return access_token;
}

async function postTokenRequest(
  request: ReturnType<typeof buildTokenRequest>,
  io: AzureCostSyncDeps,
): Promise<Response> {
  const res = await io.fetchFn(request.url, {
    method: "POST",
    signal: AbortSignal.timeout(10_000),
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: request.body,
  });

  await enforceOk(res, "Entra ID token request");

  return res;
}

/** Follows `nextLink` to the end: a truncated page would under-report spend silently, the one failure this job must not have. The link is posted with the same body, as Cost Management requires. */
async function queryAllPages(
  scope: string,
  token: string,
  io: AzureCostSyncDeps,
): Promise<GcpCostDailyRow[]> {
  const body = JSON.stringify(
    buildCostQuery(billingWindowStart(io.now), io.now.toISOString()),
  );
  const rows: GcpCostDailyRow[] = [];
  let url: string | null =
    `${ARM_BASE}/${scope}/providers/Microsoft.CostManagement/query?api-version=${COST_API_VERSION}`;

  while (url) {
    const page = parseCostQueryResponse(
      await queryPage(url, body, token, io.fetchFn),
    );

    rows.push(...page.rows);
    url = page.nextLink;
  }

  return rows;
}

async function queryPage(
  url: string,
  body: string,
  token: string,
  fetchFn: typeof fetch,
): Promise<unknown> {
  const res = await fetchFn(url, {
    method: "POST",
    signal: AbortSignal.timeout(60_000),
    headers: {
      Authorization: `Bearer ${token}`,
      "Content-Type": "application/json",
    },
    body,
  });

  await enforceOk(res, "Azure Cost Management query");

  return res.json();
}

// Reads the body only on failure: enforceTrue would build its message, and so read a large page, on every call.
async function enforceOk(res: Response, what: string): Promise<void> {
  if (!res.ok) {
    throw new Error(`${what} returned ${res.status}: ${await res.text()}`);
  }
}
