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
import type { AssemblyLinesPort } from "@re-cinq/lore-shared/project/assembly-lines/assembly-lines-port.js";
import { reportToParkedNode } from "@re-cinq/lore-shared/project/assembly-lines/parked-node.js";
import { enforceTrue } from "@re-cinq/lore-shared/lib/enforce.js";
import { projectFor } from "../../../platform/project-boot.js";
import { createTask } from "@re-cinq/lore-server-core/features/pipeline/pipeline.js";
import { bearerScope } from "../../../server/plugins/bearer-scope.js";

/**
 * /api/repos/:owner/:repo/features[...] — the smart feature-planning surface.
 * Reads go through project.features; lifecycle/task-spawning writes create
 * feature rows and kick feature-planning / feature-finalize Stations. The pod
 * posts each round's GapResult back to .../iterations/:n/result. See
 * specs/7-feature-planning/ and ADR-027.
 *
 * Scope: GET read; POST and DELETE write. (DELETE was historically under-scoped
 * to `read` — the old scope map only listed GET / POST / PUT, so a read token
 * could delete a feature — now raised to `write`.)
 */

const BASE = "/api/repos/{owner}/{repo}/features";
/** The definition whose line owns a feature's planning for its whole life. */
const PLANNING_DEFINITION = "feature-planning";

/** The node a resumed round completes, and the number it completes it at. */
type ParkedTarget = { nodeId: string; iteration: number };
const repoOf = (p: Record<string, string>) => `${p.owner}/${p.repo}`;
// hapi parses the payload natively (ADR-034); the 2 MB cap surfaces as a 413.
const WRITE_PAYLOAD = { maxBytes: 2 * 1_048_576 } as const;

/** Map a handler throw to the legacy dispatcher's outcome: ValidationError → 400, else → 500. */
async function run(
  h: ResponseToolkit,
  fn: () => Promise<ResponseObject>,
): Promise<ResponseObject> {
  try {
    return await fn();
  } catch (err) {
    if (err instanceof ValidationError) {
      return h.response({ error: err.message }).code(400);
    }

    return h
      .response({ error: err instanceof Error ? err.message : String(err) })
      .code(500);
  }
}

/** The resume event is the round. Without a pool it cannot be written, and a 202
 *  would tell the author their round started when nothing did. */
function enforcePool(pool: Pool | null): Pool {
  enforceTrue(
    pool !== null,
    Error,
    "no database pool: cannot report the round to its assembly line",
  );

  return pool;
}

/**
 * Where this round goes: back to the node the feature's line is parked on, or down
 * the legacy path that mints a line per round (FR6.21).
 *
 * The line is found through the FIRST round's task, which is the line's owner for
 * its whole life. A feature whose planning predates the merged line has no parked
 * node and must keep the old path, or it strands mid-plan.
 */
async function resolveDispatch(
  project: {
    assemblyLines: Pick<AssemblyLinesPort, "listForTask" | "listNodes">;
  },
  iterations: readonly { iteration: number; task_id: string | null }[],
): Promise<
  { kind: "legacy" } | ({ kind: "resume"; lineId: string } & ParkedTarget)
> {
  const taskId = firstTaskId(iterations);

  if (!taskId) {
    return { kind: "legacy" };
  }
  const lines = await project.assemblyLines.listForTask(taskId);
  const line = lines.find((l) => l.definitionName === PLANNING_DEFINITION);

  if (!line) {
    return { kind: "legacy" };
  }
  const decision = decideRoundDispatch(
    line.status,
    await project.assemblyLines.listNodes(line.id),
  );

  return decision.kind === "resume"
    ? { ...decision, lineId: line.id }
    : { kind: "legacy" };
}

/**
 * Kick a feature-planning Station for the next round of a feature. `repoFullName`
 * MUST be the `owner/repo` slug — it lands verbatim in `target_repo`, which the
 * pod clones as `github.com/<target_repo>.git`.
 */
/** The task that owns a feature's line: the FIRST round's. Later rounds are
 *  resumes that mint no task, so nothing after it can identify the line. */
function firstTaskId(
  iterations: readonly { iteration: number; task_id: string | null }[],
): string | null {
  return (
    [...iterations].sort((a, b) => a.iteration - b.iteration)[0]?.task_id ??
    null
  );
}

/** The id of the feature's planning line, or null. Resolved the way
 *  {@link resolveDispatch} does — the FIRST round's task owns the line for its
 *  whole life, and later rounds are resumes that mint no task of their own. */
async function planningLineId(
  project: { assemblyLines: Pick<AssemblyLinesPort, "listForTask"> },
  iterations: readonly { iteration: number; task_id: string | null }[],
): Promise<string | null> {
  const taskId = firstTaskId(iterations);

  if (!taskId) {
    return null;
  }
  const lines = await project.assemblyLines.listForTask(taskId);

  return (
    lines.find((l) => l.definitionName === PLANNING_DEFINITION)?.id ?? null
  );
}

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
    // Both forms ride along: whether the run resumes the previous round's
    // conversation is only known at dispatch, in the Floor, so it picks there.
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
      options: bearerScope("read"),
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
      options: { ...bearerScope("write"), payload: WRITE_PAYLOAD },
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
      options: bearerScope("read"),
      handler: (request, h) =>
        run(h, async () => {
          const feature = await (
            await projectFor(repoOf(request.params))
          ).features.get(request.params.id);

          if (!feature) {
            return h.response({ error: "feature not found" }).code(404);
          }

          return h.response(feature);
        }),
    },

    // GET .../features/:id/status — the planning wizard's 4s poll in one call.
    //
    // Deliberately NOT a `?view=` param on GET :id — that route carries EVERY
    // round's gap_result (mockup markup plus a repo stylesheet each), which must
    // not be re-sent every four seconds.
    {
      method: "GET",
      path: `${BASE}/{id}/status`,
      options: bearerScope("read"),
      handler: (request, h) =>
        run(h, async () => {
          const project = await projectFor(repoOf(request.params));
          const feature = await project.features.get(request.params.id);

          if (!feature) {
            return h.response({ error: "feature not found" }).code(404);
          }
          const { iterations, ...row } = feature;

          return h.response({
            feature: row,
            latest_iteration: iterations[iterations.length - 1] ?? null,
            last_ready_iteration: latestReadyIteration(iterations),
            // The line the run graph hangs on. From round 2 a resumed round mints
            // no task, so only the OWNING task — the first round's — can resolve it.
            assembly_line_id: await planningLineId(project, iterations),
          });
        }),
    },

    // GET .../features/:id/decomposition — the spec-tasks the merged spec became.
    {
      method: "GET",
      path: `${BASE}/{id}/decomposition`,
      options: bearerScope("read"),
      handler: (request, h) =>
        run(h, async () => {
          const project = await projectFor(repoOf(request.params));

          // An unknown id is NOT an empty tree. The empty list is for a feature
          // that exists and has not been decomposed yet; conflating the two would
          // report success for a typo.
          if (!(await project.features.get(request.params.id))) {
            return h.response({ error: "feature not found" }).code(404);
          }

          return h.response({
            tasks: await project.tasks.specTasksForFeature(request.params.id),
          });
        }),
    },

    // DELETE .../features/:id — remove the feature + its iterations (CASCADE).
    {
      method: "DELETE",
      path: `${BASE}/{id}`,
      options: bearerScope("write"),
      handler: (request, h) =>
        run(h, async () => {
          const deleted = await (
            await projectFor(repoOf(request.params))
          ).features.delete(request.params.id);

          if (!deleted) {
            return h.response({ error: "feature not found" }).code(404);
          }

          return h.response({ ok: true });
        }),
    },

    // POST .../features/:id/iterations — submit a refinement round.
    {
      method: "POST",
      path: `${BASE}/{id}/iterations`,
      options: { ...bearerScope("write"), payload: WRITE_PAYLOAD },
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

          if (!feature) {
            return h.response({ error: "feature not found" }).code(404);
          }

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
          // Rewind: continue from the round the author picked rather than the
          // latest. Both the prompt's draft and the conversation to resume come
          // from that ONE round, so a rewind cannot half-happen.
          // A REWIND is the author naming a round; the basis is resolved for every
          // round either way (it supplies the prior draft). Only the first is a
          // rewind, and conflating them makes every round claim to be one.
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
          const dispatch = await resolveDispatch(project, feature.iterations);
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
                // Rewind on a merged line: a resumed round mints no task, so the round
                // can only be named by the iteration it ran as. Sent on EVERY round —
                // null when the author did not rewind — because the resume MERGES into
                // the line's args rather than replacing them, so an omitted key would
                // leave an earlier rewind still steering. It must be the round the
                // AUTHOR NAMED, never the ordinary basis: the resolver honours a rewind
                // literally, so claiming one on an ordinary round drops the
                // conversation whenever that basis never archived.
                resume_from_iteration:
                  rewoundTo === undefined
                    ? null
                    : (basis.basis?.iteration ?? null),
              },
            );

            return h
              .response({
                iteration: row.iteration,
                assembly_line_id: dispatch.lineId,
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
      options: { ...bearerScope("write"), payload: WRITE_PAYLOAD },
      handler: (request, h) =>
        run(h, async () => {
          const id = request.params.id;
          const iteration = Number(request.params.n);

          if (!Number.isInteger(iteration) || iteration < 0) {
            return h
              .response({ error: "iteration must be a non-negative integer" })
              .code(400);
          }

          // Confirm the feature belongs to this repo before any write — feature.id
          // is a global UUID, so without this a write-token holder could POST a
          // forged result against another repo's feature.
          const features = (await projectFor(repoOf(request.params))).features;
          const feature = await features.get(id);

          if (!feature) {
            return h.response({ error: "feature not found" }).code(404);
          }

          // Shared with the Floor's artifact-event handler so a round reads the
          // same however the pod delivered it (applyGapResult).
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
      path: `${BASE}/{id}/finalize`,
      options: { ...bearerScope("write"), payload: WRITE_PAYLOAD },
      handler: (request, h) =>
        run(h, async () => {
          const repo = repoOf(request.params);
          const id = request.params.id;
          const project = await projectFor(repo);
          const features = project.features;
          const feature = await features.get(id);

          if (!feature) {
            return h.response({ error: "feature not found" }).code(404);
          }

          if (!canFinalize(feature.status)) {
            return h
              .response({
                error: `cannot finalize a feature in '${feature.status}' state`,
              })
              .code(409);
          }
          // Accepting is the author station reporting `success`: the spec work runs
          // on the SAME line, so what follows the accept is an edge, not a new run.
          const dispatch = await resolveDispatch(project, feature.iterations);

          if (dispatch.kind === "resume") {
            await reportToParkedNode(
              enforcePool(getPool()),
              dispatch,
              "success",
            );

            return h.response({ assembly_line_id: dispatch.lineId }).code(202);
          }
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
      options: { ...bearerScope("write"), payload: WRITE_PAYLOAD },
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

          if (!parent) {
            return h.response({ error: "feature not found" }).code(404);
          }

          if (!latestReadyGap(parent.iterations)?.split_suggestion) {
            return h
              .response({
                error: "parent feature has no split suggestion to split from",
              })
              .code(409);
          }
          const child = await features.createSplitChild(parentId, {
            title,
            prompt,
          });

          return h.response(child).code(201);
        }),
    },
  ];
}
