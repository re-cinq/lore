import type { Pool } from "pg";
import type {
  Request,
  ResponseObject,
  ResponseToolkit,
  ServerRoute,
} from "@hapi/hapi";
import { enforceTrue } from "@re-cinq/lore-shared/lib/enforce.js";
import type { RunningPodInfo } from "@re-cinq/lore-shared";
import { ClusterAgentClient } from "@re-cinq/lore-shared/cluster/cluster-agent-client.js";
import { apiError } from "@re-cinq/lore-shared/http/api-error.js";
import { bearerScope } from "../../http/bearer-scope.js";
import { zodResponse } from "../../http/zod-response.js";
import { DB_UNAVAILABLE } from "../common-schemas.js";
import { clusterAgentCredentials } from "../../../work/agents/agent-crd-k8s.js";
import { spendInterval } from "../../../work/analytics/compute-cost.js";
import { SpendWindowSchema } from "./spend-window-schema.js";
import type { SpendWindow } from "./spend-window-db.js";
import { readLlmSpend } from "./spend-window-llm.js";
import { readAnthropicSpend } from "./spend-window-anthropic.js";
import { readGcpSpend } from "./spend-window-gcp.js";
import {
  readComputeSpend,
  type SpendWindowDeps,
} from "./spend-window-compute.js";
import { readBudget } from "./spend-window-budget.js";

export type { SpendWindowDeps } from "./spend-window-compute.js";

// The whole spend screen in one interval-scoped call (absorbed the old month-to-date /api/spend): metered llm_calls, billed anthropic_cost_daily, the NON-interval-scoped credit balance, and a central-cluster-only compute estimate (live pods degrade to [] if unreachable).

const defaultDeps = (): SpendWindowDeps => ({
  livePods: async () => {
    const { baseUrl, token } = clusterAgentCredentials(process.env);

    if (!baseUrl) {
      return [];
    }

    try {
      const body = await new ClusterAgentClient(baseUrl, token).call<{
        pods: RunningPodInfo[];
      }>("GET", "/pods");

      return body?.pods ?? [];
    } catch {
      return [];
    }
  },
  env: process.env,
  now: () => new Date(),
});

/** Spend over one window, from the billing export where there is one and the per-call estimate otherwise — the estimate is labelled, so a reader knows which they are looking at. */
/** The window to report on, as INCLUSIVE day bounds — `[from 00:00, to + 1 day)`. A bad range is the caller's error (400), not a server failure, which is why the parse is caught here rather than left to the error shaper. */
function resolveWindow(
  q: Record<string, string | undefined>,
  deps: SpendWindowDeps,
): SpendWindow {
  let interval: { from: string; to: string };

  try {
    interval = spendInterval(q.from, q.to, deps.now());
  } catch (err) {
    throw apiError(400)((err as Error).message);
  }

  return {
    interval,
    fromTs: `${interval.from}T00:00:00Z`,
    toTs: new Date(
      Date.parse(`${interval.to}T00:00:00Z`) + 24 * 60 * 60 * 1000,
    ).toISOString(),
  };
}

async function serveSpendWindow(
  getPool: () => Pool | null,
  deps: SpendWindowDeps,
  request: Request,
  h: ResponseToolkit,
): Promise<ResponseObject> {
  const pool = getPool();

  enforceTrue(pool, apiError(503), DB_UNAVAILABLE);
  const win = resolveWindow(
    request.query as Record<string, string | undefined>,
    deps,
  );

  return h.response(await spendWindowBody(pool, win, deps)).code(200);
}

async function spendWindowBody(
  pool: Pool,
  win: SpendWindow,
  deps: SpendWindowDeps,
) {
  return {
    interval: win.interval,
    llm: await readLlmSpend(pool, win),
    billed: await readAnthropicSpend(pool, win),
    gcp: await readGcpSpend(pool, win),
    compute: await readComputeSpend(pool, win, deps),
    budget: await readBudget(pool),
  };
}

export function spendWindowRoute(
  getPool: () => Pool | null,
  deps: SpendWindowDeps = defaultDeps(),
): ServerRoute {
  return {
    method: "GET",
    path: "/api/analytics/spend-window",
    options: zodResponse(bearerScope("read"), SpendWindowSchema, {
      name: "SpendWindow",
      description:
        "The spend screen in one interval-scoped call: metered and billed LLM spend, their breakdowns, the recorded balance, and the estimated Kubernetes compute cost",
      errors: [400],
    }),
    handler: (request, h) => serveSpendWindow(getPool, deps, request, h),
  };
}
