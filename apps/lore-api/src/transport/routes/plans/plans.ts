import type { Request, ResponseToolkit, ServerRoute } from "@hapi/hapi";
import type { Pool } from "pg";
import { z } from "zod";
import { docName } from "@re-cinq/planning-document";
import { enforceTrue } from "@re-cinq/lore-shared/lib/enforce.js";
import { apiError } from "@re-cinq/lore-shared/http/api-error.js";
import {
  listPlanMetas,
  pgPlanStore,
} from "../../../outbound/plans/plan-store-pg.js";
import { mintCollabToken } from "../../../work/plans/collab-tokens.js";
import { bearerScope } from "../../http/bearer-scope.js";
import { zodResponse } from "../../http/zod-response.js";
import { zodValidate } from "../../http/zod-validate.js";
import { withPool } from "../with-pool.js";

const BASE = "/api/repos/{owner}/{repo}/plans";

const PlanSummarySchema = z.object({
  id: z.string(),
  title: z.string(),
  type: z.string(),
  status: z.string(),
  version: z.number(),
  createdBy: z.string(),
  updatedAt: z.string(),
});

const PlanListSchema = z.object({ plans: z.array(PlanSummarySchema) });

const CollabTokenBody = z.object({
  user: z.object({ id: z.string().min(1), name: z.string().min(1) }),
  role: z.enum(["read", "write"]),
});

const CollabTokenSchema = z.object({
  token: z.string(),
  documentName: z.string(),
});

const repoOf = (request: Request): string =>
  `${request.params.owner}/${request.params.repo}`;

/** Lore's own plan routes beside the library's /api/plans: a repo's plan list, and the collab token the web tier mints for a signed-in person. */
export function plansRoutes(getPool: () => Pool | null): ServerRoute[] {
  return [listPlansRoute(getPool), collabTokenRoute(getPool)];
}

function listPlansRoute(getPool: () => Pool | null): ServerRoute {
  return {
    method: "GET",
    path: BASE,
    options: zodResponse(bearerScope("read"), PlanListSchema, {
      name: "PlanList",
    }),
    handler: withPool(getPool, async (pool, request, h) =>
      h.response({ plans: await listPlanMetas(() => pool, repoOf(request)) }),
    ),
  };
}

// The web tier has already checked the person's session and repo access; lore-api only binds the token to this plan of this repo.
function collabTokenRoute(getPool: () => Pool | null): ServerRoute {
  return {
    method: "POST",
    path: `${BASE}/{id}/collab-token`,
    options: COLLAB_TOKEN_OPTIONS,
    handler: withPool(getPool, (pool, request, h) =>
      serveCollabToken(() => pool, request, h),
    ),
  };
}

const COLLAB_TOKEN_OPTIONS = zodResponse(
  {
    ...bearerScope("write"),
    validate: { payload: zodValidate(CollabTokenBody) },
  },
  CollabTokenSchema,
  {
    name: "PlanCollabToken",
    description:
      "A short-lived token that opens this plan's collaboration socket as one person",
    errors: [404],
  },
);

async function serveCollabToken(
  pool: () => Pool,
  request: Request,
  h: ResponseToolkit,
) {
  const repo = repoOf(request);
  const planId = String(request.params.id);
  const meta = await pgPlanStore(pool).getMeta(planId);

  enforceTrue(meta?.repo === repo, apiError(404), "plan not found");
  const body = request.payload as z.infer<typeof CollabTokenBody>;
  const token = await mintCollabToken(pool, { planId, repo, ...body });

  return h.response({ token, documentName: docName({ repo, planId }) });
}
