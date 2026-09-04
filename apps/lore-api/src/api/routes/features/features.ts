import type { ServerRoute } from "@hapi/hapi";
import type { Pool } from "pg";
import { latestReadyIteration } from "@re-cinq/lore-shared/project/features/features-port.js";
import { featureRunId } from "@re-cinq/lore-shared/project/features/planning-run.js";
import { enforceTrue } from "@re-cinq/lore-shared/lib/enforce.js";
import { apiError } from "../../../server/api-error.js";
import { projectFor } from "../../../platform/project-boot.js";
import { bearerScope } from "../../../server/plugins/bearer-scope.js";
import { zodResponse } from "../../../server/plugins/zod-response.js";
import {
  FeatureListSchema,
  FeaturePollSchema,
  FeatureDecompositionSchema,
  FeatureWithIterationsSchema,
  OkSchema,
  runIdBothSpellings,
} from "./features-schema.js";
import { BASE, repoOf, run } from "./feature-route-support.js";
import {
  createFeatureRoute,
  createIterationRoute,
  finalizeRoutes,
  iterationResultRoute,
  splitFeatureRoute,
} from "./feature-round-routes.js";

/** Feature-planning surface: Stations write GapResult back per iteration (ADR-027). */

export function featuresRoutes(getPool: () => Pool | null): ServerRoute[] {
  return [
    listFeaturesRoute(),
    createFeatureRoute(),
    getFeatureRoute(),
    featureStatusRoute(),
    featureDecompositionRoute(),
    deleteFeatureRoute(),
    createIterationRoute(getPool),
    iterationResultRoute(),
    ...finalizeRoutes(getPool),
    splitFeatureRoute(),
  ];
}

/** GET .../features — list, optionally filtered by status. */
function listFeaturesRoute(): ServerRoute {
  return {
    method: "GET",
    path: BASE,
    options: zodResponse(bearerScope("read"), FeatureListSchema, {
      name: "FeatureList",
    }),
    handler: (request, h) =>
      run(h, async () => {
        const status =
          (request.query.status as string | undefined) ?? undefined;
        const features = (await projectFor(repoOf(request.params))).features;

        return h.response({ features: await features.list(status as never) });
      }),
  };
}

/** GET .../features/:id — feature + iterations. */
function getFeatureRoute(): ServerRoute {
  return {
    method: "GET",
    path: `${BASE}/{id}`,
    options: zodResponse(bearerScope("read"), FeatureWithIterationsSchema, {
      name: "FeatureWithIterations",
      errors: [404],
    }),
    handler: (request, h) =>
      run(h, async () => {
        const feature = await (
          await projectFor(repoOf(request.params))
        ).features.get(request.params.id);

        enforceTrue(feature, apiError(404), "feature not found");

        return h.response(feature);
      }),
  };
}

/** GET .../features/:id/status — the wizard's 4s poll; gap_result too big to re-send often. */
function featureStatusRoute(): ServerRoute {
  return {
    method: "GET",
    path: `${BASE}/{id}/status`,
    options: zodResponse(bearerScope("read"), FeaturePollSchema, {
      name: "FeaturePoll",
      errors: [404],
    }),
    handler: (request, h) =>
      run(h, async () => {
        const project = await projectFor(repoOf(request.params));
        const feature = await project.features.get(request.params.id);

        enforceTrue(feature, apiError(404), "feature not found");
        const { iterations, ...row } = feature;

        return h.response({
          feature: row,
          latest_iteration: iterations[iterations.length - 1] ?? null,
          last_ready_iteration: latestReadyIteration(iterations),
          // The run the graph hangs on; a resumed round mints no task of its own.
          ...runIdBothSpellings(
            await featureRunId(project.assemblyRuns, feature.id),
          ),
        });
      }),
  };
}

/** GET .../features/:id/decomposition — the spec-tasks the merged spec became. */
function featureDecompositionRoute(): ServerRoute {
  return {
    method: "GET",
    path: `${BASE}/{id}/decomposition`,
    options: zodResponse(bearerScope("read"), FeatureDecompositionSchema, {
      name: "FeatureDecomposition",
      errors: [404],
    }),
    handler: (request, h) =>
      run(h, async () => {
        const project = await projectFor(repoOf(request.params));

        // Unknown id is NOT empty tree; conflating them reports success for typos.
        enforceTrue(
          await project.features.get(request.params.id),
          apiError(404),
          "feature not found",
        );

        return h.response({
          tasks: await project.tasks.specTasksForFeature(request.params.id),
        });
      }),
  };
}

/** DELETE .../features/:id — remove the feature + its iterations (CASCADE). */
function deleteFeatureRoute(): ServerRoute {
  return {
    method: "DELETE",
    path: `${BASE}/{id}`,
    options: zodResponse(bearerScope("write"), OkSchema, {
      name: "Ok",
      errors: [404],
    }),
    handler: (request, h) =>
      run(h, async () => {
        const deleted = await (
          await projectFor(repoOf(request.params))
        ).features.delete(request.params.id);

        enforceTrue(deleted, apiError(404), "feature not found");

        return h.response({ ok: true });
      }),
  };
}
