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
import { decideRoundDispatch } from "@re-cinq/lore-shared/feature-planning/round-dispatch.js";
import type { AssemblyRuns } from "@re-cinq/lore-shared/project/assembly-runs/assembly-runs.js";
import { featureSubject } from "@re-cinq/lore-shared/project/assembly-runs/subject-keys.js";
import { reportToParkedNode } from "@re-cinq/lore-shared/project/assembly-runs/parked-node.js";
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
  FinalizeStartedSchema,
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
/** The definition whose line owns a feature's planning for its whole life. */
const PLANNING_DEFINITION = "feature-planning";

/** The node a resumed round completes, and the number it completes it at. */
type ParkedTarget = { nodeId: string; iteration: number };
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

/** The resume event IS the round: without a pool, a 202 would tell the author
 *  their round started when nothing did. */
function enforcePool(pool: Pool | null): Pool {
  enforceTrue(
    pool !== null,
    Error,
    "no database pool: cannot report the round to its assembly line",
  );

  return pool;
}

/**
 * Where this round goes: the node the feature's line is parked on, or the legacy
 * path that mints a line per round (FR6.21).
 *
 * Found by SUBJECT KEY, never through the first round's task — a failed round 1
 * lets round 2 mint its own line, after which a task-keyed resolver sees only the
 * finished one and takes the legacy path forever (#1462). Newest line wins.
 */
/// todo: we don't care about legacy features here. We must work only with assembly runs.
async function resolveDispatch(
  project: {
    assemblyRuns: Pick<AssemblyRuns, "listForSubject" | "listStationRuns">;
  },
  featureId: string,
): Promise<
  { kind: "legacy" } | ({ kind: "resume"; lineId: string } & ParkedTarget)
> {
  const lines = await project.assemblyRuns.listForSubject(
    featureSubject(featureId),
  );
  const line = lines.find((l) => l.blueprintName === PLANNING_DEFINITION);

  if (!line) {
    return { kind: "legacy" };
  }
  const decision = decideRoundDispatch(
    line.status,
    await project.assemblyRuns.listStationRuns(line.id),
    line.graph,
  );

  return decision.kind === "resume"
    ? { ...decision, lineId: line.id }
    : { kind: "legacy" };
}

/**
 * The run already working this feature, or null. Asked ONLY where a NEW run would
 * start: the resume path needs an open run, so guarding there would reject every
 * ordinary refine. Finalize is the only caller — refine has `roundInFlight`.
 */
async function runAlreadyWorking(
  project: { assemblyRuns: Pick<AssemblyRuns, "findOpenBySubject"> },
  featureId: string,
): Promise<string | null> {
  const open = await project.assemblyRuns.findOpenBySubject(
    featureSubject(featureId),
  );

  return open?.id ?? null;
}

/**
 * The run the feature page draws: the NEWEST run for this feature, whatever
 * blueprint it is — filtering to `feature-planning` hid the finalize run, so
 * "Create spec PR" looked like nothing happened. Newest, not newest-OPEN: a
 * finished run must still show, failure reason and all.
 */
async function featureRunId(
  project: { assemblyRuns: Pick<AssemblyRuns, "listForSubject"> },
  featureId: string,
): Promise<string | null> {
  const runs = await project.assemblyRuns.listForSubject(
    featureSubject(featureId),
  );

  return runs[0]?.id ?? null;
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
            ...runIdBothSpellings(await featureRunId(project, feature.id)),
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
          const basis = resolveRoundBasis(feature.iterations, rewoundTo);

          if (!basis.ok) {
            return h.response({ error: basis.error }).code(400);
          }
          const priorGap = basis.basis?.gap_result ?? null;
          const description = composePlanningPrompt({
            title: feature.title,
            originalPrompt: feature.original_prompt,
            priorGap,
            answers,
          });
          const dispatch = await resolveDispatch(project, id);
          const row = await features.appendIteration(
            id,
            answers,
            basis.basis?.iteration ?? null,
          );
          const roundFeedback = composeRoundFeedback({
            round: row.iteration,
            priorGap,
            answers,
          });

          if (dispatch.kind === "resume") {
            await reportToParkedNode(
              enforcePool(getPool()),
              dispatch,
              "changes_requested",
              {
                description,
                round_feedback: roundFeedback,
                iteration: row.iteration,
                // Sent on EVERY round (null when there was no rewind): the resume
                // MERGES into the line's args, so an omitted key would leave an
                // earlier rewind still steering. Must be the round the AUTHOR named
                // — the resolver honours a rewind literally.
                resume_from_iteration:
                  rewoundTo === undefined
                    ? null
                    : (basis.basis?.iteration ?? null),
              },
            );

            return h
              .response({
                iteration: row.iteration,
                ...runIdBothSpellings(dispatch.lineId),
                task_id: null,
              })
              .code(202);
          }
          const taskId = await kickPlanning(
            repo,
            id,
            row.iteration,
            description,
            roundFeedback,
            basis.basis?.task_id ?? null,
          );

          await features.attachIterationTask(id, row.iteration, taskId);

          return h
            .response({ task_id: taskId, iteration: row.iteration })
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

    // POST .../features/:id/finalize — kick the finalize Station.
    {
      method: "POST",
      /// todo: the "finalize" term is incorrect here because this endpoint just moves the context in the assembly run to the next station and starts it.
      /// one of the next steps are to review a PR for the spec, so the user still needs to provide feedback on the assembly run.
      /// you must rename the endpoint to something like "createSpecFile"
      /// todo: this handler must also get any form response like it gets in the iteration and add it to the context, and continue with the run instead of
      /// doing analyze again
      path: `${BASE}/{id}/finalize`,
      options: {
        ...zodResponse(bearerScope("write"), FinalizeStartedSchema, {
          name: "FinalizeStarted",
          status: 202,
          errors: [404, 409],
        }),
        payload: WRITE_PAYLOAD,
      },
      handler: (request, h) =>
        run(h, async () => {
          const repo = repoOf(request.params);
          const id = request.params.id;
          const project = await projectFor(repo);
          const features = project.features;
          const feature = await features.get(id);

          enforceTrue(feature, apiError(404), "feature not found");

          enforceTrue(
            canFinalize(feature.status),
            apiError(409),
            `cannot finalize a feature in '${feature.status}' state`,
          );
          // Accepting is the author station reporting `success`: the spec work runs
          // on the SAME line, so what follows the accept is an edge, not a new run.
          /// TODO: what is the meaning of the "dispatch" term in this context? it is very confusing and we need a better name for the function and the variable
          const dispatch = await resolveDispatch(project, id);

          if (dispatch.kind === "resume") {
            await reportToParkedNode(
              enforcePool(getPool()),
              dispatch,
              "success",
              {
                // Tail nodes read args.description as "the accepted plan"; without
                // this the shallow merge leaves the last refine's brief there (#1470).
                description: composePlanningPrompt({
                  title: feature.title,
                  originalPrompt: feature.original_prompt,
                  priorGap: latestReadyGap(feature.iterations),
                  answers: null,
                }),
                // An omitted key SURVIVES the shallow merge, so both refine
                // leftovers are nulled outright rather than left to steer.
                round_feedback: null,
                resume_from_iteration: null,
              },
            );

            return h.response(runIdBothSpellings(dispatch.lineId)).code(202);
          }
          // `canFinalize` gates on feature.status, which does not move until a PR
          // lands ~18min later, so every click in that window used to mint another
          // task, run, branch and spec PR. The id rides the 409 because a duplicate
          // press means "show me", not "you broke something".
          const inFlight = await runAlreadyWorking(project, id);

          // Composable before the guard decides because `runIdBothSpellings` is
          // generic over `string | null`. `prefer-api-error` skips this shape —
          // without type information it cannot tell it from the ones that break.
          enforceTrue(
            !inFlight,
            apiError(409, runIdBothSpellings(inFlight)),
            "a run is already in flight for this feature",
          );
          const task = await createTask(
            `Finalize feature: ${feature.title}`,
            "feature-finalize",
            repo,
            "ui",
            { feature_id: id, slug: feature.slug },
            "immediate",
          );

          return h.response({ task_id: task.task_id }).code(202);
        }),
    },

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
