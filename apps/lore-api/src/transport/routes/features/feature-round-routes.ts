// The routes that start or advance a feature's planning round: create (kicks round 1), submit a refinement round, post a round's GapResult, accept/finalize, and split off a child draft.

import type { Request, ResponseToolkit, ServerRoute } from "@hapi/hapi";
import type { Pool } from "pg";
import { applyGapResult } from "@re-cinq/lore-shared/feature-planning/apply-gap-result.js";
import { enforceFeatureInput } from "@re-cinq/lore-shared/feature-planning/feature-input.js";
import { latestReadyGap } from "@re-cinq/lore-shared/project/features/features-port.js";

import {
  startFeaturePlanning,
  type StartPlanningDeps,
} from "@re-cinq/lore-shared/project/features/start-planning.js";
import { enforceTrue } from "@re-cinq/lore-shared/lib/enforce.js";
import { apiError } from "@re-cinq/lore-shared/http/api-error.js";
import { projectFor } from "../../../outbound/project-boot.js";
import { createTask } from "@re-cinq/lore-server-core/features/pipeline/pipeline.js";
import { bearerScope } from "../../http/bearer-scope.js";
import { zodResponse } from "../../http/zod-response.js";
import {
  FeatureCreatedSchema,
  RoundStartedSchema,
  SpecFileStartedSchema,
  FeatureSchema,
  OkSchema,
  runIdBothSpellings,
} from "./features-schema.js";
import { run, BASE, WRITE_PAYLOAD, repoOf } from "./feature-route-support.js";
import { acceptPlan, startPlanningRound } from "./feature-round-actions.js";

/** Binds planning sequence to task queue; repo lands verbatim in target_repo. */
const createPlanningTask: StartPlanningDeps["createPlanningTask"] = async ({
  repo,
  description,
  args,
}) => {
  const task = await createTask({
    description,
    taskType: "feature-planning",
    targetRepo: repo,
    createdBy: "ui",
    contextBundle: args,
    priority: "immediate",
  });

  return task.task_id as string;
};

interface CreateFeatureBody {
  title?: unknown;
  prompt?: unknown;
  parent_feature_id?: string;
}

/** How the shared planning starter reaches this repo's own feature store. */
function planningDeps(
  features: Awaited<ReturnType<typeof projectFor>>["features"],
): Parameters<typeof startFeaturePlanning>[1] {
  return {
    createFeature: (feature) => features.create(feature),
    appendIteration: (featureId, answers) =>
      features.appendIteration(featureId, answers),
    createPlanningTask,
    attachIterationTask: (featureId, iteration, taskId) =>
      features.attachIterationTask(featureId, iteration, taskId),
  };
}

/** POST .../features — create a draft + kick planning round 1. */
/** Files the feature and starts its first planning round. The sequence itself lives in shared — this contributes the payload parsing and the 201. */
async function createFeature(request: Request, h: ResponseToolkit) {
  const body = request.payload as CreateFeatureBody;
  const { title, prompt } = enforceFeatureInput(body.title, body.prompt);
  const repo = repoOf(request.params);
  const features = (await projectFor(repo)).features;
  const started = await startFeaturePlanning(
    { repo, title, prompt, parentFeatureId: body.parent_feature_id },
    planningDeps(features),
  );

  return h
    .response({ id: started.featureId, task_id: started.taskId })
    .code(201);
}

export function createFeatureRoute(): ServerRoute {
  return {
    method: "POST",
    path: BASE,
    options: {
      ...zodResponse(bearerScope("write"), FeatureCreatedSchema, {
        name: "FeatureCreated",
        status: 201,
        errors: [400],
      }),
      payload: WRITE_PAYLOAD,
    },
    handler: (request, h) => run(h, () => createFeature(request, h)),
  };
}

/** POST .../features/:id/iterations — submit a refinement round. */
export function createIterationRoute(getPool: () => Pool | null): ServerRoute {
  return {
    method: "POST",
    path: `${BASE}/{id}/iterations`,
    options: {
      ...zodResponse(bearerScope("write"), RoundStartedSchema, {
        name: "RoundStarted",
        status: 202,
        errors: [400, 404, 409],
      }),
      payload: WRITE_PAYLOAD,
    },
    handler: (request, h) =>
      run(h, async () => {
        const result = await startPlanningRound(getPool, request);

        return h.response(result.body).code(result.code);
      }),
  };
}

/** POST .../features/:id/iterations/:n/result — the planning pod posts a GapResult. */
/** Records one round's gap result. The feature id is a global uuid, so the repo in the path is CHECKED rather than decorative — without it, a caller could post a result onto another repo's feature. `applyGapResult` is shared with the Floor's artifact-event handler, so a round reads the same whether its result arrived by pod or by API. */
async function recordIterationResult(request: Request, h: ResponseToolkit) {
  const id = request.params.id;
  const iteration = Number(request.params.n);

  enforceTrue(
    Number.isInteger(iteration) && iteration >= 0,
    apiError(400),
    "iteration must be a non-negative integer",
  );
  const features = (await projectFor(repoOf(request.params))).features;

  enforceTrue(await features.get(id), apiError(404), "feature not found");

  const applied = await applyGapResult(
    features,
    id,
    iteration,
    request.payload,
  );

  return applied.outcome === "failed"
    ? h.response({ error: applied.error }).code(400)
    : h.response({ ok: true });
}

export function iterationResultRoute(): ServerRoute {
  return {
    method: "POST",
    path: `${BASE}/{id}/iterations/{n}/result`,
    options: {
      ...zodResponse(bearerScope("write"), OkSchema, {
        name: "Ok",
        errors: [400, 404],
      }),
      payload: WRITE_PAYLOAD,
    },
    handler: (request, h) => run(h, () => recordIterationResult(request, h)),
  };
}

/** One accept-the-plan route; the two spellings differ only in path while the UI rolls over. */
function finalizeRoute(getPool: () => Pool | null, path: string): ServerRoute {
  return {
    method: "POST",
    path,
    options: {
      ...zodResponse(bearerScope("write"), SpecFileStartedSchema, {
        name: "SpecFileStarted",
        status: 202,
        errors: [404, 409],
      }),
      payload: WRITE_PAYLOAD,
    },
    handler: (request, h) =>
      run(h, async () => {
        const parked = await acceptPlan(getPool, request);

        return h.response(runIdBothSpellings(parked.lineId)).code(202);
      }),
  };
}

/** POST .../features/:id/create-spec-file and /finalize — accept the plan; served both paths during UI rollout. */
export function finalizeRoutes(getPool: () => Pool | null): ServerRoute[] {
  return [`${BASE}/{id}/create-spec-file`, `${BASE}/{id}/finalize`].map(
    (path) => finalizeRoute(getPool, path),
  );
}

/** POST .../features/:id/split — create a child draft from a split suggestion. */
/** Creates a child feature from a split suggestion. The parent must actually CARRY a suggestion (409 otherwise): a split invented by the caller would produce a child with no plan behind it, and the parent's own round is what justifies the division. */
async function splitFeature(request: Request, h: ResponseToolkit) {
  const parentId = request.params.id;
  const body = request.payload as { title?: unknown; prompt?: unknown };
  const { title, prompt } = enforceFeatureInput(body.title, body.prompt);
  const features = (await projectFor(repoOf(request.params))).features;
  const parent = await features.get(parentId);

  enforceTrue(parent, apiError(404), "feature not found");
  enforceTrue(
    latestReadyGap(parent.iterations)?.split_suggestion,
    apiError(409),
    "parent feature has no split suggestion to split from",
  );

  return h
    .response(await features.createSplitChild(parentId, { title, prompt }))
    .code(201);
}

export function splitFeatureRoute(): ServerRoute {
  return {
    method: "POST",
    path: `${BASE}/{id}/split`,
    options: {
      ...zodResponse(bearerScope("write"), FeatureSchema, {
        name: "Feature",
        status: 201,
        errors: [400, 404, 409],
      }),
      payload: WRITE_PAYLOAD,
    },
    handler: (request, h) => run(h, () => splitFeature(request, h)),
  };
}
