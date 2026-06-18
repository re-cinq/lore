import type { IncomingMessage, ServerResponse } from "node:http";
import type { Pool } from "pg";
import {
  parseGapResult,
  sanitizeSvg,
  decideFeatureStatus,
  isPlanningPhase,
  type GapResult,
} from "@re-cinq/lore-shared/feature-planning/gap-result.js";
import {
  composePlanningPrompt,
  type SectionAnswers,
} from "@re-cinq/lore-shared/feature-planning/planning-prompt.js";
import { projectFor } from "../../platform/project-boot.js";
import { createTask } from "../../features/pipeline/pipeline.js";
import { json, readJsonBody } from "./http.js";

/**
 * /api/repos/:owner/:repo/features[...] — the smart feature-planning surface.
 * Reads go through project.features; lifecycle/task-spawning writes create
 * feature rows and kick feature-planning / feature-finalize Stations. The pod
 * posts each round's GapResult back to .../iterations/:n/result. See
 * specs/7-feature-planning/ and ADR-027.
 */

const RESULT_RE = /^\/api\/repos\/([^/]+)\/([^/]+)\/features\/([^/]+)\/iterations\/([^/]+)\/result(?:\?.*)?$/;
const ITERATIONS_RE = /^\/api\/repos\/([^/]+)\/([^/]+)\/features\/([^/]+)\/iterations(?:\?.*)?$/;
const FINALIZE_RE = /^\/api\/repos\/([^/]+)\/([^/]+)\/features\/([^/]+)\/finalize(?:\?.*)?$/;
const SPLIT_RE = /^\/api\/repos\/([^/]+)\/([^/]+)\/features\/([^/]+)\/split(?:\?.*)?$/;
const ONE_RE = /^\/api\/repos\/([^/]+)\/([^/]+)\/features\/([^/]+)(?:\?.*)?$/;
const LIST_RE = /^\/api\/repos\/([^/]+)\/([^/]+)\/features(?:\?(.*))?$/;

/**
 * Kick a feature-planning Station for the next round of a feature. `repoFullName`
 * MUST be the `owner/repo` slug — it lands verbatim in `target_repo`, which the
 * pod clones as `github.com/<target_repo>.git`; a bare repo name 404s the clone.
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

export async function handleFeaturesRoute(
  req: IncomingMessage,
  res: ServerResponse,
  _pool: Pool | null,
): Promise<void> {
  const url = req.url || "";
  const method = req.method || "GET";

  try {
    //TODO: priority HIGH We must have one function per route!!!!

    // POST .../features/:id/iterations/:n/result — the planning pod posts a GapResult.
    let m = url.match(RESULT_RE);

    if (m && method === "POST") {
      const [, owner, repo, id, nRaw] = m;
      const iteration = Number(nRaw);

      if (!Number.isInteger(iteration) || iteration < 0) {
        return json(res, 400, { error: "iteration must be a non-negative integer" });
      }

      const features = (await projectFor(`${owner}/${repo}`)).features;
      // Confirm the feature belongs to this repo before any write — feature.id is
      // a global UUID, so without this a write-token holder could POST a forged
      // result against another repo's feature.

      const feature = await features.get(id);
      if (!feature) return json(res, 404, { error: "feature not found" });

      let planningResult: GapResult;

      try {
        planningResult = parseGapResult(await readJsonBody(req));
      } catch (err) {
        await features.setIterationResult(id, iteration, null, "failed");
        return json(res, 400, { error: err instanceof Error ? err.message : String(err) });
      }

      planningResult.mockups = planningResult.mockups.map((mk) => ({ ...mk, markup: sanitizeSvg(mk.markup) }));
      await features.setIterationResult(id, iteration, planningResult, "ready");

      // Only advance a feature that's still mid-planning. A slow/retried/duplicate
      // pod POSTing a stale GapResult must not drag a finalized feature
      // (pr-open/implemented/split) back into the wizard.

      if (isPlanningPhase(feature.status)) {
        await features.transitionStatus(id, decideFeatureStatus(planningResult), {
          draft_spec_md: planningResult.draft_spec_markdown,
        });
      }

      return json(res, 200, { ok: true });
    }

    // POST .../features/:id/iterations — submit a refinement round.
    m = url.match(ITERATIONS_RE);
    if (m && method === "POST") {
      const [, owner, repo, id] = m;
      const body = (await readJsonBody(req)) as { user_answers?: unknown };
      const features = (await projectFor(`${owner}/${repo}`)).features;
      const feature = await features.get(id);

      if (!feature) {
        return json(res, 404, { error: "feature not found" });
      }

      // Carry the whole-feature timeline into the round's prompt: the prior round's
      // generated sections paired with the author's feedback (FR-2.3 / ADR-027).
      const priorGap =
        feature.iterations.find((it) => it.status === "ready" && it.gap_result)?.gap_result ?? null;

      const description = composePlanningPrompt({
        title: feature.title,
        originalPrompt: feature.original_prompt,
        priorGap,
        answers: (body.user_answers ?? null) as SectionAnswers | null,
      });

      // Allocate the iteration atomically FIRST, then spawn the pod with the row
      // the DB actually minted (not current_iteration+1 read off a stale
      // snapshot), then link the task. Two concurrent refines thus drive distinct
      // rows instead of both targeting the same guessed number.

      const row = await features.appendIteration(id, body.user_answers ?? null);
      const taskId = await kickPlanning(`${owner}/${repo}`, id, row.iteration, description);
      await features.attachIterationTask(id, row.iteration, taskId);

      return json(res, 202, { task_id: taskId, iteration: row.iteration });
    }

    // POST .../features/:id/finalize — kick the finalize Station.
    m = url.match(FINALIZE_RE);
    if (m && method === "POST") {
      const [, owner, repo, id] = m;
      const features = (await projectFor(`${owner}/${repo}`)).features;
      const feature = await features.get(id);
      if (!feature) return json(res, 404, { error: "feature not found" });
      const task = await createTask(
        `Finalize feature: ${feature.title}`,
        "feature-finalize",
        `${owner}/${repo}`,
        "ui",
        { feature_id: id, slug: feature.slug },
        "immediate",
      );
      return json(res, 202, { task_id: task.task_id });
    }

    // POST .../features/:id/split — create a child draft from a split suggestion.
    m = url.match(SPLIT_RE);
    if (m && method === "POST") {
      const [, owner, repo, parentId] = m;
      const body = (await readJsonBody(req)) as { title?: string; prompt?: string };
      if (!body.title || !body.prompt) {
        return json(res, 400, { error: "title and prompt are required" });
      }
      const features = (await projectFor(`${owner}/${repo}`)).features;
      const child = await features.createSplitChild(parentId, {
        title: body.title,
        prompt: body.prompt,
      });
      return json(res, 201, child);
    }

    // GET .../features/:id — feature + iterations.
    m = url.match(ONE_RE);
    if (m && method === "GET") {
      const [, owner, repo, id] = m;
      const feature = await (await projectFor(`${owner}/${repo}`)).features.get(id);
      if (!feature) return json(res, 404, { error: "feature not found" });
      return json(res, 200, feature);
    }

    // DELETE .../features/:id — remove the feature + its iterations (CASCADE).
    if (m && method === "DELETE") {
      const [, owner, repo, id] = m;
      const deleted = await (await projectFor(`${owner}/${repo}`)).features.delete(id);
      if (!deleted) return json(res, 404, { error: "feature not found" });
      return json(res, 200, { ok: true });
    }

    // GET .../features — list; POST .../features — create draft + kick planning.
    m = url.match(LIST_RE);
    if (m) {
      const [, owner, repo, queryString] = m;
      const features = (await projectFor(`${owner}/${repo}`)).features;
      if (method === "GET") {
        const status = new URLSearchParams(queryString ?? "").get("status") ?? undefined;
        return json(res, 200, { features: await features.list(status as never) });
      }
      if (method === "POST") {
        const body = (await readJsonBody(req)) as {
          title?: string;
          prompt?: string;
          parent_feature_id?: string;
        };
        if (!body.title || !body.prompt) {
          return json(res, 400, { error: "title and prompt are required" });
        }
        const feature = await features.create({
          title: body.title,
          prompt: body.prompt,
          parentFeatureId: body.parent_feature_id,
        });
        const row = await features.appendIteration(feature.id, null);
        const taskId = await kickPlanning(`${owner}/${repo}`, feature.id, row.iteration, body.prompt);
        await features.attachIterationTask(feature.id, row.iteration, taskId);
        return json(res, 201, { id: feature.id, task_id: taskId });
      }
    }

    return json(res, 404, { error: "not found" });
  } catch (err) {
    return json(res, 500, { error: err instanceof Error ? err.message : String(err) });
  }
}
