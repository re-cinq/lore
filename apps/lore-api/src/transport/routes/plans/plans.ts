import type { Request, ResponseToolkit, ServerRoute } from "@hapi/hapi";
import type { Pool } from "pg";
import { z } from "zod";
import { docName } from "@re-cinq/planning-document";
import { enforceTrue } from "@re-cinq/lore-shared/lib/enforce.js";
import { apiError } from "@re-cinq/lore-shared/http/api-error.js";
import {
  deletePlan,
  listPlanMetas,
  pgPlanStore,
} from "../../../outbound/plans/plan-store-pg.js";
import { mintCollabToken } from "../../../work/plans/collab-tokens.js";
import { askRefine, startDrafting } from "../../../work/plans/planning-line.js";
import {
  projectionOf,
  resumeDepsFor,
  specWorkDepsFor,
} from "./plan-line-deps.js";
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

const repoOf = (request: Request): string =>
  `${request.params.owner}/${request.params.repo}`;

/** Lore's own plan routes beside the library's /api/plans: a repo's plan list, deleting a plan, the collab token the web tier mints for a signed-in person, and the planning line's drafting and Refine. */
export function plansRoutes(getPool: () => Pool | null): ServerRoute[] {
  return [
    listPlansRoute(getPool),
    deletePlanRoute(getPool),
    collabTokenRoute(getPool),
    draftingRoute(getPool),
    refineRoute(getPool),
  ];
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

function deletePlanRoute(getPool: () => Pool | null): ServerRoute {
  return {
    method: "DELETE",
    path: `${BASE}/{id}`,
    options: zodResponse(bearerScope("write"), PlanDeletedSchema, {
      name: "PlanDeleted",
      description:
        "The plan is gone for good, with its document, versions and collab tokens",
      errors: [404],
    }),
    handler: withPool(getPool, async (pool, request, h) => {
      const plan = await repoPlan(() => pool, request);

      await deletePlan(() => pool, plan.id);

      return h.response({ id: plan.id });
    }),
  };
}

const PlanDeletedSchema = z.object({ id: z.string() });

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

const CollabTokenBody = z.object({
  user: z.object({ id: z.string().min(1), name: z.string().min(1) }),
  role: z.enum(["read", "write"]),
});

const CollabTokenSchema = z.object({
  token: z.string(),
  documentName: z.string(),
});

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

// The agent's first draft of a plan this repo owns, from what its author already knows.
function draftingRoute(getPool: () => Pool | null): ServerRoute {
  return {
    method: "POST",
    path: `${BASE}/{id}/drafting`,
    options: DRAFTING_OPTIONS,
    handler: withPool(getPool, async (pool, request, h) => {
      const plan = await repoPlan(() => pool, request);
      const body = request.payload as z.infer<typeof DraftingBody>;
      const taskId = await startDrafting(specWorkDepsFor(plan.repo, pool), {
        plan,
        projection: await projectionOf(() => pool, plan.id),
        ...body,
      });

      return h.response({ task_id: taskId }).code(202);
    }),
  };
}

const DraftingBody = z.object({
  known: z.string(),
  createdBy: z.string().min(1),
});

const DraftingSchema = z.object({ task_id: z.string() });

const DRAFTING_OPTIONS = zodResponse(
  { ...bearerScope("write"), validate: { payload: zodValidate(DraftingBody) } },
  DraftingSchema,
  {
    name: "PlanDraftingStarted",
    status: 202,
    description:
      "The planning agent's first draft of the plan has been asked for",
    errors: [404],
  },
);

// One section back to the agent; 409 while it is still at work, so the editor withdraws the ask.
function refineRoute(getPool: () => Pool | null): ServerRoute {
  return {
    method: "POST",
    path: `${BASE}/{id}/refine`,
    options: REFINE_OPTIONS,
    handler: withPool(getPool, async (pool, request, h) => {
      const plan = await repoPlan(() => pool, request);

      const refine = request.payload as z.infer<typeof RefineBody>;

      await askRefine(
        resumeDepsFor(plan.repo, pool),
        plan.id,
        await projectionOf(() => pool, plan.id),
        refine,
      );

      return h.response({ slot: refine.slot }).code(202);
    }),
  };
}

const RefineBody = z.object({
  slot: z.string().min(1),
  title: z.string(),
  baseHash: z.string().min(1),
  inputs: z.unknown(),
  uses: z.unknown(),
});

const RefineSchema = z.object({ slot: z.string() });

const REFINE_OPTIONS = zodResponse(
  { ...bearerScope("write"), validate: { payload: zodValidate(RefineBody) } },
  RefineSchema,
  {
    name: "PlanRefineAsked",
    status: 202,
    description: "The planning agent has been asked to refine one section",
    errors: [404, 409],
  },
);

// The plan the path names, only when it belongs to the path's repo.
async function repoPlan(db: () => Pool, request: Request) {
  const meta = await pgPlanStore(db).getMeta(String(request.params.id));

  enforceTrue(meta?.repo === repoOf(request), apiError(404), "plan not found");

  return meta;
}
