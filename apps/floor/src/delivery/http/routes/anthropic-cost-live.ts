/**
 * GET /api/anthropic-cost/live — the Anthropic Admin API cost/usage report,
 * fetched on demand so /spend can show current figures instead of waiting for
 * the 07:00 UTC `anthropic_cost_sync` cron.
 *
 * The Floor serves this rather than the web-ui calling Anthropic directly: the
 * `sk-ant-admin` key is org-wide read access to all billing, and it is already
 * mounted here (`lore-anthropic-key` / `anthropic-admin-key`). Proxying keeps it
 * out of the `lore-ui` namespace entirely.
 *
 * Responses are cached for `ttlMs` because every /spend page view is a call and
 * the Admin API's rate-limit ceiling is not published (the rate-limit docs cover
 * Messages/Batches/Managed Agents/fast mode only). The cache holds the promise,
 * so concurrent page loads collapse into one upstream call; a rejection is never
 * cached, or one transient 5xx would pin the page to the DB fallback for a
 * minute.
 *
 * A missing key is a 503, not an empty 200 — the caller must be able to tell
 * "not configured" from "configured, and the org spent nothing".
 */

import Boom from "@hapi/boom";
import { enforceTrue } from "@re-cinq/lore-shared/lib/enforce.js";
import { fetchAnthropicCostRows } from "../../../jobs/cost/anthropic-cost-sync/anthropic-cost-sync.js";
import type { ServerRoute } from "@hapi/hapi";
import type { AnthropicCostDailyRow } from "../../../jobs/cost/anthropic-cost.js";

export interface LiveCostPayload {
  rows: AnthropicCostDailyRow[];
  fetchedAt: string;
}

const DEFAULT_TTL_MS = 60_000;

export function anthropicCostLiveRoute(
  fetchRows: (
    adminKey: string,
  ) => Promise<AnthropicCostDailyRow[]> = fetchAnthropicCostRows,
  ttlMs: number = DEFAULT_TTL_MS,
): ServerRoute {
  let cached: Promise<LiveCostPayload> | undefined;
  let cachedAt = 0;

  return {
    method: "GET",
    path: "/api/anthropic-cost/live",
    options: { auth: "ingest-token" },
    handler: async (_request, h) => {
      const adminKey = process.env.ANTHROPIC_ADMIN_KEY;

      enforceTrue(
        adminKey,
        Boom.serverUnavailable,
        "ANTHROPIC_ADMIN_KEY not set",
      );

      if (!cached || Date.now() - cachedAt >= ttlMs) {
        cachedAt = Date.now();

        const invocation: Promise<LiveCostPayload> = fetchRows(adminKey)
          .then((rows) => ({ rows, fetchedAt: new Date().toISOString() }))
          .catch((err: unknown) => {
            // Identity check: a slow rejection must not evict a newer entry.
            if (cached === invocation) {
              cached = undefined;
            }
            throw err;
          });

        cached = invocation;
      }

      return h.response(await cached).code(200);
    },
  };
}
