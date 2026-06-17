import type { IncomingMessage, ServerResponse } from "node:http";
import type { Pool } from "pg";
import {
  parseGapResult,
  sanitizeSvg,
  decideFeatureStatus,
  type GapResult,
} from "@re-cinq/lore-shared/feature-planning/gap-result.js";
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

/** Kick a feature-planning Station for the next round of a feature. */
async function kickPlanning(
  repo: string,
  featureId: string,
  iteration: number,
  description: string,
): Promise<string> {
  const task = await createTask(
    description,
    "feature-planning",
    repo,
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
    // POST .../features/:id/iterations/:n/result — the planning pod posts a GapResult.
    let m = url.match(RESULT_RE);
    if (m && method === "POST") {
      const [, owner, repo, id, nRaw] = m;
      const iteration = Number(nRaw);
      const features = (await projectFor(`${owner}/${repo}`)).features;
      let gap: GapResult;
      try {
        gap = parseGapResult(await readJsonBody(req));
      } catch (err) {
        await features.setIterationResult(id, iteration, null, "failed");
        return json(res, 400, { error: err instanceof Error ? err.message : String(err) });
      }
      gap.mockups = gap.mockups.map((mk) => ({ ...mk, markup: sanitizeSvg(mk.markup) }));
      await features.setIterationResult(id, iteration, gap, "ready");
      await features.transitionStatus(id, decideFeatureStatus(gap), {
        draft_spec_md: gap.draft_spec_markdown,
      });
      return json(res, 200, { ok: true });
    }

    // POST .../features/:id/iterations — submit a refinement round.
    m = url.match(ITERATIONS_RE);
    if (m && method === "POST") {
      const [, owner, repo, id] = m;
      const body = (await readJsonBody(req)) as { user_answers?: unknown };
      const features = (await projectFor(`${owner}/${repo}`)).features;
      const feature = await features.get(id);
      if (!feature) return json(res, 404, { error: "feature not found" });
      const iteration = feature.current_iteration + 1;
      // Carry the whole-feature timeline into the round's prompt: the accumulated
      // draft plus the author's feedback for this round (FR-2.3 / ADR-027).
      const description = [
        feature.original_prompt,
        "",
        "## Current draft spec (latest round)",
        feature.draft_spec_md ?? "(none yet)",
        "",
        "## Author feedback for this round",
        JSON.stringify(body.user_answers ?? {}, null, 2),
      ].join("\n");
      const taskId = await kickPlanning(repo, id, iteration, description);
      const row = await features.appendIteration(id, taskId, body.user_answers ?? null);
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
        repo,
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
        const iteration = feature.current_iteration + 1;
        const taskId = await kickPlanning(repo, feature.id, iteration, body.prompt);
        await features.appendIteration(feature.id, taskId, null);
        return json(res, 201, { id: feature.id, task_id: taskId });
      }
    }

    return json(res, 404, { error: "not found" });
  } catch (err) {
    return json(res, 500, { error: err instanceof Error ? err.message : String(err) });
  }
}
