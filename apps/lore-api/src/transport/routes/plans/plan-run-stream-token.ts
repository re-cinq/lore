// POST /api/repos/{owner}/{repo}/plans/{id}/run-stream-token — the token a browser opens this plan's `plan-run` channel of the live socket with (ADR-048, specs/plan-detail-fast-open FR4). The web tier has already checked the person's session and repo access; lore-api only binds the token to this plan of this repo.

import type { Request, ResponseToolkit, ServerRoute } from "@hapi/hapi";
import type { Pool } from "pg";
import type { z } from "zod";
import { enforceTrue } from "@re-cinq/lore-shared/lib/enforce.js";
import { apiError } from "@re-cinq/lore-shared/http/api-error.js";
import { pgPlanStore } from "../../../outbound/plans/plan-store-pg.js";
import { mintLiveToken } from "../../../work/assembly-line-station/live-tokens.js";
import {
  StreamTokenBody,
  streamTokenOptions,
} from "../assembly-lines/run-stream-token.js";
import { withPool } from "../with-pool.js";

type LiveUser = { id: string; name: string };

const OPTIONS = streamTokenOptions({
  name: "PlanRunStreamToken",
  description:
    "A short-lived token that opens this plan's plan-run channel of the live socket (/api/ws) as one person: the plan's current planning run, followed across runs",
  errors: [404],
});

/** Injectable for tests; production reads the plan through the pool. */
export interface PlanRunStreamTokenDeps {
  /** The repository the plan belongs to; null for no such plan. */
  planRepo: (planId: string) => Promise<string | null>;
  mint: (
    planId: string,
    user: LiveUser,
  ) => Promise<{ token: string; expiresAt: Date }>;
}

export function planRunStreamTokenRoute(
  getPool: () => Pool | null,
  injected?: PlanRunStreamTokenDeps,
): ServerRoute {
  return {
    method: "POST",
    path: "/api/repos/{owner}/{repo}/plans/{id}/run-stream-token",
    options: OPTIONS,
    handler: withPool(getPool, (pool, request, h) =>
      serveToken(injected ?? pgDeps(pool), request, h),
    ),
  };
}

function pgDeps(pool: Pool): PlanRunStreamTokenDeps {
  return {
    planRepo: async (planId) =>
      (await pgPlanStore(() => pool).getMeta(planId))?.repo ?? null,
    mint: (planId, user) =>
      mintLiveToken(() => pool, { kind: "plan-run", subject: planId, user }),
  };
}

async function serveToken(
  deps: PlanRunStreamTokenDeps,
  request: Request,
  h: ResponseToolkit,
) {
  const planId = String(request.params.id);
  const repo = `${request.params.owner}/${request.params.repo}`;

  enforceTrue(
    (await deps.planRepo(planId)) === repo,
    apiError(404),
    "plan not found",
  );
  const { user } = request.payload as z.infer<typeof StreamTokenBody>;
  const minted = await deps.mint(planId, user);

  return h.response({ token: minted.token, expires_at: minted.expiresAt });
}
