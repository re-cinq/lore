import type { ResponseToolkit, ResponseObject, ServerRoute } from "@hapi/hapi";
import type { Pool } from "pg";
import { applyGapResult } from "@re-cinq/lore-shared/feature-planning/apply-gap-result.js";
import {
  composePlanningPrompt,
  composeRoundFeedback,
} from "@re-cinq/lore-shared/feature-planning/planning-prompt.js";
import {
  enforceFeatureInput,
  parseSectionAnswers,
  ValidationError,
} from "@re-cinq/lore-shared/feature-planning/feature-input.js";
import {
  roundInFlight,
  canFinalize,
  latestReadyGap,
  resolveRoundBasis,
  latestReadyIteration,
} from "@re-cinq/lore-shared/project/features/features-port.js";
import {
  featureRunId,
  findParkedAuthorNode,
} from "@re-cinq/lore-shared/project/features/planning-run.js";
import { startRefinementRound } from "@re-cinq/lore-shared/project/features/refinement-round.js";
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

/**
 * /api/repos/:owner/:repo/features[...] — the feature-planning surface. Writes
 * kick feature-planning / feature-finalize Stations; the pod posts each round's
 * GapResult back to .../iterations/:n/result. GET is `read`, POST and DELETE are
 * `write`. See specs/7-feature-planning/ and ADR-027.
 */

const BASE = "/api/repos/{owner}/{repo}/features";

const repoOf = (p: Record<string, string>) => `${p.owner}/${p.repo}`;
// hapi parses the payload natively (ADR-034); the 2 MB cap surfaces as a 413.
const WRITE_PAYLOAD = { maxBytes: 2 * 1_048_576 } as const;

/** ValidationError → 400, else → 500. A Boom passes through: it already carries
 *  the status its guard meant, and reshaping it would make every refusal a fault. */
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

/** Kick a feature-planning Station. `repoFullName` MUST be the `owner/repo` slug:
 *  it lands verbatim in `target_repo`, cloned as `github.com/<target_repo>.git`. */
async function kickPlanning(
  repoFullName: string,
  featureId: string,
  iteration: number,
  description: string,
  roundFeedback?: string,
  resumeFromTask?: string | null,
): Promise<string> {
  const task = await createTask(
    description,
    "feature-planning",
    repoFullName,
    "ui",
    // Both ride along: only the Floor knows at dispatch whether to resume.
    {
      feature_id: featureId,
      iteration,
      ...(roundFeedback ? { round_feedback: roundFeedback } : {}),
      ...(resumeFromTask ? { resume_from_task: resumeFromTask } : {}),
    },
    "immediate",
  );

  return task.task_id as string;
}

export function featuresRoutes(getPool: () => Pool | null): ServerRoute[] {
  return [
    // GET .../features — list, optionally filtered by status.
    {
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
    },

    // POST .../features — create a draft + kick planning round 1.
    {
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
          const { title, prompt } = enforceFeatureInput(
            body.title,
            body.prompt,
          );
          const repo = repoOf(request.params);
          const features = (await projectFor(repo)).features;
          const feature = await features.create({
            title,
            prompt,
            parentFeatureId: body.parent_feature_id,
          });
          const row = await features.appendIteration(feature.id, null);
          const taskId = await kickPlanning(
            repo,
            feature.id,
            row.iteration,
            prompt,
          );

          await features.attachIterationTask(feature.id, row.iteration, taskId);

          return h.response({ id: feature.id, task_id: taskId }).code(201);
        }),
    },

    // GET .../features/:id — feature + iterations.
    {
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
    },

    // GET .../features/:id/status — the wizard's 4s poll. NOT a `?view=` on GET
    // :id, which carries every round's gap_result — too big to re-send that often.
    {
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
    },

    // GET .../features/:id/decomposition — the spec-tasks the merged spec became.
    {
      method: "GET",
      path: `${BASE}/{id}/decomposition`,
      options: zodResponse(bearerScope("read"), FeatureDecompositionSchema, {
        name: "FeatureDecomposition",
        errors: [404],
      }),
      handler: (request, h) =>
        run(h, async () => {
          const project = await projectFor(repoOf(request.params));

          // An unknown id is NOT an empty tree — that is a feature not yet
          // decomposed, and conflating them reports success for a typo.
          enforceTrue(
            await project.features.get(request.params.id),
            apiError(404),
            "feature not found",
          );

          return h.response({
            tasks: await project.tasks.specTasksForFeature(request.params.id),
          });
        }),
    },

    // DELETE .../features/:id — remove the feature + its iterations (CASCADE).
    {
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
    },

    // POST .../features/:id/iterations — submit a refinement round.
    {
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

          // One planning round per feature at a time (a stale page / double-click
          // must not spawn a 2nd pod). An orphaned `running` past the window is dead.
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
          // A rewind is the AUTHOR naming a round; a basis is resolved either way.
          // Conflating them makes every round claim to be a rewind.
          const rewoundTo =
            typeof body.from_iteration === "number"
              ? body.from_iteration
              : undefined;

          // The sequence — and its two load-bearing orderings — lives in shared,
          // under test. The route contributes only what is HTTP: which error is
          // a 400 and which a 409.
          const round = await startRefinementRound(
            feature,
            { answers, rewoundTo },
            {
              invalidBasis: apiError(400),
              notParked: (runId) => apiError(409, runIdBothSpellings(runId)),
              parkedNode: (featureId) =>
                findParkedAuthorNode(project.assemblyRuns, featureId),
              appendIteration: (featureId, roundAnswers, basisIteration) =>
                features.appendIteration(
                  featureId,
                  roundAnswers,
                  basisIteration,
                ),
              report: (target, outcome, args) =>
                reportToParkedNode(
                  eventReporterFor(getPool()),
                  target,
                  outcome,
                  args,
                ),
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
    },

    // POST .../features/:id/iterations/:n/result — the planning pod posts a GapResult.
    {
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

          // feature.id is a global UUID: without this repo check a write-token
          // holder could forge a result against another repo's feature.
          const features = (await projectFor(repoOf(request.params))).features;
          const feature = await features.get(id);

          enforceTrue(feature, apiError(404), "feature not found");

          // Shared with the Floor's artifact-event handler, so a round reads the
          // same however the pod delivered it.
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
    },

    // POST .../features/:id/create-spec-file — accept the plan and let the SAME
    // line walk on to the spec work. It was `/finalize`, which named neither what
    // it does nor when: nothing is final here, the run simply moves to the next
    // station and a human still reviews the spec PR that comes out. Served at both
    // paths while the UI catches up (expand/contract, as #1423 and #1270 do) —
    // lore-api and web-ui are separate workloads of the umbrella chart and are
    // never atomically in step.
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
            // The author fills the form and accepts in one motion, so the accept
            // carries answers exactly as a refine does. Dropping them left the last
            // thing the author said about the plan out of the plan.
            const answers = parseSectionAnswers(body.user_answers);
            // Accepting is the author station reporting `success`: the spec work runs
            // on the SAME line, so what follows the accept is an edge, not a new run.
            const { runId, parked } = await findParkedAuthorNode(
              project.assemblyRuns,
              id,
            );

            // ONE guard, and it is structural. `canFinalize` reads feature.status,
            // which does not move until a PR lands ~18min later, so it cannot tell a
            // second press from a first; the parked node can — reporting an outcome
            // to the author node is what un-parks it, so the second press finds
            // nothing to report to. The run id rides the refusal because a duplicate
            // press means "show me", not "you broke something".
            enforceTrue(
              parked,
              apiError(409, runIdBothSpellings(runId)),
              "no plan is waiting to be accepted — this feature's line is not parked on the author",
            );

            await reportToParkedNode(
              eventReporterFor(getPool()),
              parked,
              "success",
              {
                // Tail nodes read args.description as "the accepted plan"; without
                // this the shallow merge leaves the last refine's brief there (#1470).
                description: composePlanningPrompt({
                  title: feature.title,
                  originalPrompt: feature.original_prompt,
                  priorGap: latestReadyGap(feature.iterations),
                  answers,
                }),
                // An omitted key SURVIVES the shallow merge, so both refine
                // leftovers are nulled outright rather than left to steer.
                round_feedback: null,
                resume_from_iteration: null,
              },
            );

            return h.response(runIdBothSpellings(parked.lineId)).code(202);
          }),
      }),
    ),

    // POST .../features/:id/split — create a child draft from a split suggestion.
    {
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
          const { title, prompt } = enforceFeatureInput(
            body.title,
            body.prompt,
          );
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
    },
  ];
}
