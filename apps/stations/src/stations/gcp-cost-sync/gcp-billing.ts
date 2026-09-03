import { enforceTrue } from "@re-cinq/lore-shared/lib/enforce.js";
import { z } from "zod";
import type { GcpCostDailyRow } from "@re-cinq/lore-shared/project/cost/cost-port.js";

/**
 * The pure half of the GCP billing sync: which export table to read, the SQL
 * that reads it, and the parse of BigQuery's stringly-typed query response.
 *
 * Google publishes actual spend through exactly one machine-readable channel —
 * the Cloud Billing export to BigQuery — so this is a BigQuery read, not a
 * Billing API call (that API serves SKU price lists, never an invoice).
 */

/** Standard usage-cost export tables carry this prefix plus the billing
 *  account id. The detailed (`_resource_`) export nests per-resource rows we
 *  would only re-aggregate, so the standard table is preferred when both
 *  exist. */
const STANDARD_EXPORT_PREFIX = "gcp_billing_export_v1_";
const DETAILED_EXPORT_PREFIX = "gcp_billing_export_resource_v1_";

/**
 * The export table to read from a dataset's table list, or null before the
 * console-side export setup has produced one — a state the sync reports as a
 * skip rather than an error, since only a Billing Admin in the Cloud Console
 * can change it.
 */
export function pickBillingTable(tableIds: string[]): string | null {
  return (
    tableIds.find((id) => id.startsWith(STANDARD_EXPORT_PREFIX)) ??
    tableIds.find((id) => id.startsWith(DETAILED_EXPORT_PREFIX)) ??
    null
  );
}

/**
 * One day/service rollup over the export, windowed and filtered to the
 * platform's own project — the export spans the whole billing account, and a
 * neighbour project's spend on the Lore spend page would be a lie.
 *
 * Credits are summed from their nested array separately from cost: the net is
 * a rendering concern, and net-only storage cannot be taken apart again.
 */
export function buildBillingQuery(
  table: { project: string; dataset: string; tableId: string },
  windowStartIso: string,
): string {
  return `SELECT FORMAT_DATE('%F', DATE(usage_start_time, 'UTC')) AS bucket_date,
       service.description AS service,
       SUM(cost) AS cost_usd,
       SUM((SELECT COALESCE(SUM(c.amount), 0) FROM UNNEST(credits) AS c)) AS credits_usd
  FROM \`${table.project}.${table.dataset}.${table.tableId}\`
 WHERE usage_start_time >= TIMESTAMP('${windowStartIso}')
   AND project.id = '${table.project}'
 GROUP BY bucket_date, service
 ORDER BY bucket_date, service`;
}

/** BigQuery's REST query response: every cell arrives as a string under
 *  `f[].v`, in the SELECT's column order. */
const QueryResponse = z.object({
  jobComplete: z.boolean().optional(),
  rows: z
    .array(z.object({ f: z.array(z.object({ v: z.string().nullable() })) }))
    .optional(),
});

export function parseBillingQueryResponse(raw: unknown): GcpCostDailyRow[] {
  const response = QueryResponse.parse(raw);

  enforceTrue(
    response.jobComplete !== false,
    Error,
    "BigQuery billing query did not complete in time",
  );

  return (response.rows ?? []).map((row) => ({
    bucketDate: row.f[0]?.v ?? "",
    service: row.f[1]?.v ?? "",
    costUsd: Number(row.f[2]?.v ?? 0),
    creditsUsd: Number(row.f[3]?.v ?? 0),
  }));
}
