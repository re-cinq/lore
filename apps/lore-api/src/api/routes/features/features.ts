import type { ResponseToolkit, ResponseObject, ServerRoute } from "@hapi/hapi";
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
} from "@re-cinq/lore-shared/project/features/features-port.js";
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

/**
 * Kick a feature-planning Station for the next round of a feature. `repoFullName`
 * MUST be the `owner/repo` slug — it lands verbatim in `target_repo`, which the
 * pod clones as `github.com/<target_repo>.git`.
 */
async function kickPlanning(
  repoFullName: string,
  featureId: string,
  iteration: number,
  description: string,
): Promise<string> {
  const task = await createTask(
    description,
    "feature-planning",
    repoFullName,
    "ui",
    { feature_id: featureId, iteration },
    "immediate",
  );

  return task.task_id as string;
}

export function featuresRoutes(): ServerRoute[] {
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
          const body = request.payload as { user_answers?: unknown };
          const features = (await projectFor(repo)).features;
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
          const description = composePlanningPrompt({
            title: feature.title,
            originalPrompt: feature.original_prompt,
            priorGap: latestReadyGap(feature.iterations),
            answers,
          });
          const row = await features.appendIteration(id, answers);
          const taskId = await kickPlanning(
            repo,
            id,
            row.iteration,
            description,
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
          const features = (await projectFor(repo)).features;
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
