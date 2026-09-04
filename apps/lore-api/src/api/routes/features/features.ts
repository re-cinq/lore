import type { ResponseToolkit, ResponseObject, ServerRoute } from "@hapi/hapi";
import type { Pool } from "pg";
import { applyGapResult } from "@re-cinq/lore-shared/feature-planning/apply-gap-result.js";
import { composePlanningPrompt } from "@re-cinq/lore-shared/feature-planning/planning-prompt.js";
import {
  enforceFeatureInput,
  parseSectionAnswers,
  ValidationError,
} from "@re-cinq/lore-shared/feature-planning/feature-input.js";
import {
  roundInFlight,
  canFinalize,
  latestReadyGap,
  latestReadyIteration,
} from "@re-cinq/lore-shared/project/features/features-port.js";
import {
  featureRunId,
  findParkedAuthorNode,
} from "@re-cinq/lore-shared/project/features/planning-run.js";
import { startRefinementRound } from "@re-cinq/lore-shared/project/features/refinement-round.js";
import {
  startFeaturePlanning,
  type StartPlanningDeps,
} from "@re-cinq/lore-shared/project/features/start-planning.js";
import { reportToParkedNode } from "@re-cinq/lore-shared/project/assembly-runs/parked-node.js";
import { eventReporterFor } from "../event-reporter.js";
import { enforceTrue } from "@re-cinq/lore-shared/lib/enforce.js";
import { apiError, rethrowBoom } from "../../../server/api-error.js";
import { projectFor } from "../../../platform/project-boot.js";
import { createTask } from "@re-cinq/lore-server-core/features/pipeline/pipeline.js";
import { bearerScope } from "../../../server/plugins/bearer-scope.js";
import { zodResponse } from "../../../server/plugins/zod-response.js";
import {
  FeatureListSchema,
  FeaturePollSchema,
  FeatureDecompositionSchema,
  FeatureWithIterationsSchema,
  FeatureCreatedSchema,
  RoundStartedSchema,
  SpecFileStartedSchema,
  FeatureSchema,
  OkSchema,
  runIdBothSpellings,
} from "./features-schema.js";

/** Feature-planning surface: Stations write GapResult back per iteration (ADR-027). */

const BASE = "/api/repos/{owner}/{repo}/features";

const repoOf = (p: Record<string, string>) => `${p.owner}/${p.repo}`;
// hapi parses the payload natively (ADR-034); the 2 MB cap surfaces as a 413.
const WRITE_PAYLOAD = { maxBytes: 2 * 1_048_576 } as const;

/** ValidationError → 400, else → 500; Boom passes through with its guard's status. */
async function run(
  h: ResponseToolkit,
  fn: () => Promise<ResponseObject>,
): Promise<ResponseObject> {
  try {
    return await fn();
  } catch (err) {
    rethrowBoom(err);

    if (err instanceof ValidationError) {
      return h.response({ error: err.message }).code(400);
    }

    return h
      .response({ error: err instanceof Error ? err.message : String(err) })
      .code(500);
  }
}

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
    // POST .../features/:id/create-spec-file and /finalize; served both paths during UI rollout.
    ...[`${BASE}/{id}/create-spec-file`, `${BASE}/{id}/finalize`].map(
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
            const repo = repoOf(request.params);
            const id = request.params.id;
            const body = request.payload as { user_answers?: unknown };
            const project = await projectFor(repo);
            const features = project.features;
            const feature = await features.get(id);

            enforceTrue(feature, apiError(404), "feature not found");
            enforceTrue(
              canFinalize(feature.status),
              apiError(409),
              `cannot finalize a feature in '${feature.status}' state`,
            );
            // Accept carries answers like refine; dropping them loses author feedback.
            const answers = parseSectionAnswers(body.user_answers);
            // Accepting reports success to author node; spec work runs on same line as edge.
            const { runId, parked } = await findParkedAuthorNode(
              project.assemblyRuns,
              id,
            );

            // Structural guard: canFinalize + parked node detect double-click; run-id explains refusal.
            enforceTrue(
              parked,
              apiError(409, runIdBothSpellings(runId)),
              "no plan is waiting to be accepted — this feature's line is not parked on the author",
            );
            await reportToParkedNode(eventReporterFor(getPool()), parked, {
              outcome: "success",
              args: {
                // Tail nodes read description; shallow merge would leave refine's brief (#1470).
                description: composePlanningPrompt({
                  title: feature.title,
                  originalPrompt: feature.original_prompt,
                  priorGap: latestReadyGap(feature.iterations),
                  answers,
                }),
                // Omitted keys survive shallow merge; null them to clear refine leftovers.
                round_feedback: null,
                resume_from_iteration: null,
              },
            });

            return h.response(runIdBothSpellings(parked.lineId)).code(202);
          }),
      }),
    ),
    // POST .../features/:id/split — create a child draft from a split suggestion.
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

/** POST .../features — create a draft + kick planning round 1. */
function createFeatureRoute(): ServerRoute {
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

/** POST .../features/:id/iterations — submit a refinement round. */
function createIterationRoute(getPool: () => Pool | null): ServerRoute {
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
        const repo = repoOf(request.params);
        const id = request.params.id;
        const body = request.payload as {
          user_answers?: unknown;
          from_iteration?: unknown;
        };
        const project = await projectFor(repo);
        const features = project.features;
        const feature = await features.get(id);

        enforceTrue(feature, apiError(404), "feature not found");

        // One planning round per feature; orphaned `running` past window is dead.
        const inFlight = roundInFlight(feature.iterations, Date.now());

        if (inFlight) {
          return h
            .response({
              error: `A planning round (round ${inFlight.iteration}) is already running for this feature — wait for it to finish before starting another.`,
              iteration: inFlight.iteration,
            })
            .code(409);
        }

        const answers = parseSectionAnswers(body.user_answers);
        // Rewind is author-named; basis resolved either way; conflating them breaks rewind.
        const rewoundTo =
          typeof body.from_iteration === "number"
            ? body.from_iteration
            : undefined;

        // Sequence logic in shared; route contributes only HTTP error status mapping.
        const round = await startRefinementRound(
          feature,
          { answers, rewoundTo },
          {
            invalidBasis: apiError(400),
            notParked: (runId) => apiError(409, runIdBothSpellings(runId)),
            parkedNode: (featureId) =>
              findParkedAuthorNode(project.assemblyRuns, featureId),
            appendIteration: (featureId, roundAnswers, basisIteration) =>
              features.appendIteration(featureId, roundAnswers, basisIteration),
            report: (target, outcome, args) =>
              reportToParkedNode(eventReporterFor(getPool()), target, {
                outcome,
                args,
              }),
          },
        );

        return h
          .response({
            iteration: round.iteration,
            ...runIdBothSpellings(round.runId),
            task_id: null,
          })
          .code(202);
      }),
  };
}

/** POST .../features/:id/iterations/:n/result — the planning pod posts a GapResult. */
function iterationResultRoute(): ServerRoute {
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

/** POST .../features/:id/split — create a child draft from a split suggestion. */
function splitFeatureRoute(): ServerRoute {
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
