// The routes that start or advance a feature's planning round: create (kicks round 1), submit a refinement round, post a round's GapResult, accept/finalize, and split off a child draft.

import type { ServerRoute } from "@hapi/hapi";
import type { Pool } from "pg";
import { applyGapResult } from "@re-cinq/lore-shared/feature-planning/apply-gap-result.js";
import { enforceFeatureInput } from "@re-cinq/lore-shared/feature-planning/feature-input.js";
import { latestReadyGap } from "@re-cinq/lore-shared/project/features/features-port.js";

import {
  startFeaturePlanning,
  type StartPlanningDeps,
} from "@re-cinq/lore-shared/project/features/start-planning.js";
import { enforceTrue } from "@re-cinq/lore-shared/lib/enforce.js";
import { apiError } from "../../http/api-error.js";
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

/** POST .../features — create a draft + kick planning round 1. */
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
    handler: (request, h) =>
      run(h, async () => {
        const body = request.payload as {
          title?: unknown;
          prompt?: unknown;
          parent_feature_id?: string;
        };
        const { title, prompt } = enforceFeatureInput(body.title, body.prompt);
        const repo = repoOf(request.params);
        const features = (await projectFor(repo)).features;
        // Sequence logic in shared; route contributes HTTP payload parsing + 201 response.
        const started = await startFeaturePlanning(
          {
            repo,
            title,
            prompt,
            parentFeatureId: body.parent_feature_id,
          },
          {
            createFeature: (feature) => features.create(feature),
            appendIteration: (featureId, answers) =>
              features.appendIteration(featureId, answers),
            createPlanningTask,
            attachIterationTask: (featureId, iteration, taskId) =>
              features.attachIterationTask(featureId, iteration, taskId),
          },
        );

        return h
          .response({ id: started.featureId, task_id: started.taskId })
          .code(201);
      }),
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
    handler: (request, h) =>
      run(h, async () => {
        const id = request.params.id;
        const iteration = Number(request.params.n);

        enforceTrue(
          Number.isInteger(iteration) && iteration >= 0,
          apiError(400),
          "iteration must be a non-negative integer",
        );

        // feature.id is global UUID; repo check prevents forging results.
        const features = (await projectFor(repoOf(request.params))).features;
        const feature = await features.get(id);

        enforceTrue(feature, apiError(404), "feature not found");

        // Shared with Floor's artifact-event handler; round reads same regardless of pod delivery.
        const applied = await applyGapResult(
          features,
          id,
          iteration,
          request.payload,
        );

        if (applied.outcome === "failed") {
          return h.response({ error: applied.error }).code(400);
        }

        return h.response({ ok: true });
      }),
  };
}

/** POST .../features/:id/create-spec-file and /finalize — accept the plan; served both paths during UI rollout. */
export function finalizeRoutes(getPool: () => Pool | null): ServerRoute[] {
  return [`${BASE}/{id}/create-spec-file`, `${BASE}/{id}/finalize`].map(
    (path): ServerRoute => ({
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
    }),
  );
}

/** POST .../features/:id/split — create a child draft from a split suggestion. */
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
    handler: (request, h) =>
      run(h, async () => {
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
        const child = await features.createSplitChild(parentId, {
          title,
          prompt,
        });

        return h.response(child).code(201);
      }),
  };
}
