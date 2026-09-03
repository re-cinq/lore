import { enforceTrue } from "@re-cinq/lore-shared/lib/enforce.js";
import type { GcpCostPort } from "@re-cinq/lore-shared/project/cost/cost-port.js";
import {
  buildBillingQuery,
  parseBillingQueryResponse,
  pickBillingTable,
} from "./gcp-billing.js";

const BIGQUERY_BASE = "https://bigquery.googleapis.com/bigquery/v2";
const METADATA_TOKEN_URL =
  "http://metadata.google.internal/computeMetadata/v1/instance/service-accounts/default/token";
// Same trailing window as the Anthropic sync, for the same reason: Google
// restates late-arriving usage days after the fact, and a re-pulled window
// self-heals through the upsert.
const SYNC_WINDOW_DAYS = 31;
const DAY_MS = 24 * 60 * 60 * 1000;

/** Today's UTC midnight minus 30 days — 31 whole candidate days, aligned to
 *  what `bucket_date` means downstream. */
export function billingWindowStart(now: Date): string {
  const today = Date.UTC(
    now.getUTCFullYear(),
    now.getUTCMonth(),
    now.getUTCDate(),
  );

  return new Date(today - (SYNC_WINDOW_DAYS - 1) * DAY_MS).toISOString();
}

/**
 * Workload Identity's token, straight from the GKE metadata server — the pod
 * carries no key file, and the metadata server is what the bound GCP service
 * account answers through. Nothing to configure and nothing to rotate.
 */
async function fetchAccessToken(): Promise<string> {
  const res = await fetch(METADATA_TOKEN_URL, {
    signal: AbortSignal.timeout(10_000),
    headers: { "Metadata-Flavor": "Google" },
  });

  if (!res.ok) {
    throw new Error(
      `GKE metadata token request returned ${res.status}: ${await res.text()}`,
    );
  }

  const body = (await res.json()) as { access_token?: string };

  enforceTrue(
    body.access_token,
    Error,
    "GKE metadata token response carried no access_token",
  );

  return body.access_token;
}

async function bigQueryCall<T>(
  path: string,
  token: string,
  init: RequestInit = {},
): Promise<T> {
  const res = await fetch(`${BIGQUERY_BASE}${path}`, {
    signal: AbortSignal.timeout(60_000),
    ...init,
    headers: {
      Authorization: `Bearer ${token}`,
      "Content-Type": "application/json",
      ...init.headers,
    },
  });

  if (!res.ok) {
    throw new Error(
      `BigQuery ${path} returned ${res.status}: ${await res.text()}`,
    );
  }

  return (await res.json()) as T;
}

/**
 * The daily pull: find the export table in the configured dataset, roll it up
 * per day/service over the trailing window, upsert.
 *
 * Skips (never fails) on every state only a person can change: the env not
 * configured, or the console-side export not yet producing a table. `/spend`
 * degrades to the estimate either way.
 */
export async function gcpCostSyncJob(
  costs: GcpCostPort,
  env: NodeJS.ProcessEnv = process.env,
): Promise<string> {
  const project = env.LORE_GCP_BILLING_PROJECT;
  const dataset = env.LORE_GCP_BILLING_DATASET;

  if (!project || !dataset) {
    return "LORE_GCP_BILLING_PROJECT / LORE_GCP_BILLING_DATASET not set; skipping GCP billing sync";
  }

  const token = await fetchAccessToken();
  const tables = await bigQueryCall<{
    tables?: Array<{ tableReference?: { tableId?: string } }>;
  }>(`/projects/${project}/datasets/${dataset}/tables?maxResults=1000`, token);
  const tableId = pickBillingTable(
    (tables.tables ?? [])
      .map((t) => t.tableReference?.tableId)
      .filter((id): id is string => !!id),
  );

  if (!tableId) {
    return `no billing export table in ${project}.${dataset} yet; enable the Cloud Billing export in the console`;
  }

  const response = await bigQueryCall(`/projects/${project}/queries`, token, {
    method: "POST",
    body: JSON.stringify({
      query: buildBillingQuery(
        { project, dataset, tableId },
        billingWindowStart(new Date()),
      ),
      useLegacySql: false,
      timeoutMs: 30_000,
      maxResults: 10_000,
    }),
  });
  const rows = parseBillingQueryResponse(response);

  await Promise.all(rows.map((row) => costs.upsertGcpDaily(row)));

  const netUsd = rows.reduce((sum, r) => sum + r.costUsd + r.creditsUsd, 0);

  return `Synced ${rows.length} day/service rows from ${tableId} over ${SYNC_WINDOW_DAYS}d ($${netUsd.toFixed(2)} net billed)`;
}
