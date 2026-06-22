import type { IncomingMessage, ServerResponse } from "node:http";
import type { Pool } from "pg";
import {
  parseGapResult,
  sanitizeGapResult,
  decideFeatureStatus,
  isPlanningPhase,
  type GapResult,
} from "@re-cinq/lore-shared/feature-planning/gap-result.js";
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
import { projectFor } from "../../platform/project-boot.js";
import { createTask } from "../../features/pipeline/pipeline.js";
import { json, readJsonBody } from "./http.js";

/**
 * /api/repos/:owner/:repo/features[...] — the smart feature-planning surface.
 * Reads go through project.features; lifecycle/task-spawning writes create
 * feature rows and kick feature-planning / feature-finalize Stations. The pod
 * posts each round's GapResult back to .../iterations/:n/result. See
 * specs/7-feature-planning/ and ADR-027.
 *
 * One function per route, dispatched through ROUTES (specific paths before the
 * `/features/:id` and `/features` catch-alls). Handlers throw {@link ValidationError}
 * for client faults (→ 400); any other throw becomes a 500 in the dispatcher.
 */

const RESULT_RE = /^\/api\/repos\/([^/]+)\/([^/]+)\/features\/([^/]+)\/iterations\/([^/]+)\/result(?:\?.*)?$/;
const ITERATIONS_RE = /^\/api\/repos\/([^/]+)\/([^/]+)\/features\/([^/]+)\/iterations(?:\?.*)?$/;
const FINALIZE_RE = /^\/api\/repos\/([^/]+)\/([^/]+)\/features\/([^/]+)\/finalize(?:\?.*)?$/;
const SPLIT_RE = /^\/api\/repos\/([^/]+)\/([^/]+)\/features\/([^/]+)\/split(?:\?.*)?$/;
const ONE_RE = /^\/api\/repos\/([^/]+)\/([^/]+)\/features\/([^/]+)(?:\?.*)?$/;
const LIST_RE = /^\/api\/repos\/([^/]+)\/([^/]+)\/features(?:\?(.*))?$/;

type RouteHandler = (req: IncomingMessage, res: ServerResponse, m: RegExpMatchArray) => Promise<void>;

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

// POST .../features/:id/iterations/:n/result — the planning pod posts a GapResult.
const postIterationResult: RouteHandler = async (req, res, m) => {
  const [, owner, repo, id, nRaw] = m;
  const iteration = Number(nRaw);
  if (!Number.isInteger(iteration) || iteration < 0) {
    return json(res, 400, { error: "iteration must be a non-negative integer" });
  }

  // Confirm the feature belongs to this repo before any write — feature.id is a
  // global UUID, so without this a write-token holder could POST a forged result
  // against another repo's feature.
  const features = (await projectFor(`${owner}/${repo}`)).features;
  const feature = await features.get(id);
  if (!feature) return json(res, 404, { error: "feature not found" });

  let planningResult: GapResult;
  try {
    planningResult = sanitizeGapResult(parseGapResult(await readJsonBody(req)));
  } catch (err) {
    await features.setIterationResult(id, iteration, null, "failed");
    return json(res, 400, { error: err instanceof Error ? err.message : String(err) });
  }

  await features.setIterationResult(id, iteration, planningResult, "ready");

  // Only advance a feature that's still mid-planning. A slow/retried/duplicate pod
  // POSTing a stale GapResult must not drag a finalized feature (pr-open/implemented/
  // split) back into the wizard.
  if (isPlanningPhase(feature.status)) {
    await features.transitionStatus(id, decideFeatureStatus(planningResult), {
      draft_spec_md: planningResult.draft_spec_markdown,
    });
  }

  return json(res, 200, { ok: true });
};

// POST .../features/:id/iterations — submit a refinement round.
const postIteration: RouteHandler = async (req, res, m) => {
  const [, owner, repo, id] = m;
  const body = (await readJsonBody(req)) as { user_answers?: unknown };
  const features = (await projectFor(`${owner}/${repo}`)).features;
  const feature = await features.get(id);
  if (!feature) return json(res, 404, { error: "feature not found" });

  // Reject a concurrent/duplicate round: only one planning round may run per feature
  // at a time (a stale page or double-click must not spawn a 2nd pod). An orphaned
  // `running` iteration past the window does not block (it's dead).
  const inFlight = roundInFlight(feature.iterations, Date.now());
  if (inFlight) {
    return json(res, 409, {
      error: `A planning round (round ${inFlight.iteration}) is already running for this feature — wait for it to finish before starting another.`,
      iteration: inFlight.iteration,
    });
  }

  // Carry the whole-feature timeline into the round's prompt: the latest ready round's
  // generated sections paired with the author's (validated) feedback (FR-2.3 / ADR-027).
  const answers = parseSectionAnswers(body.user_answers);
  const description = composePlanningPrompt({
    title: feature.title,
    originalPrompt: feature.original_prompt,
    priorGap: latestReadyGap(feature.iterations),
    answers,
  });

  // Allocate the iteration atomically FIRST, then spawn the pod with the row the DB
  // actually minted (not current_iteration+1 read off a stale snapshot), then link the
  // task. Two concurrent refines thus drive distinct rows.
  const row = await features.appendIteration(id, answers);
  const taskId = await kickPlanning(`${owner}/${repo}`, id, row.iteration, description);
  await features.attachIterationTask(id, row.iteration, taskId);

  return json(res, 202, { task_id: taskId, iteration: row.iteration });
};

// POST .../features/:id/finalize — kick the finalize Station.
const postFinalize: RouteHandler = async (_req, res, m) => {
  const [, owner, repo, id] = m;
  const features = (await projectFor(`${owner}/${repo}`)).features;
  const feature = await features.get(id);
  if (!feature) return json(res, 404, { error: "feature not found" });
  if (!canFinalize(feature.status)) {
    return json(res, 409, { error: `cannot finalize a feature in '${feature.status}' state` });
  }
  const task = await createTask(
    `Finalize feature: ${feature.title}`,
    "feature-finalize",
    `${owner}/${repo}`,
    "ui",
    { feature_id: id, slug: feature.slug },
    "immediate",
  );
  return json(res, 202, { task_id: task.task_id });
};

// POST .../features/:id/split — create a child draft from a split suggestion.
const postSplit: RouteHandler = async (req, res, m) => {
  const [, owner, repo, parentId] = m;
  const body = (await readJsonBody(req)) as { title?: unknown; prompt?: unknown };
  const { title, prompt } = enforceFeatureInput(body.title, body.prompt);
  const features = (await projectFor(`${owner}/${repo}`)).features;
  const parent = await features.get(parentId);
  if (!parent) return json(res, 404, { error: "feature not found" });
  if (!latestReadyGap(parent.iterations)?.split_suggestion) {
    return json(res, 409, { error: "parent feature has no split suggestion to split from" });
  }
  const child = await features.createSplitChild(parentId, { title, prompt });
  return json(res, 201, child);
};

// GET .../features/:id — feature + iterations.
const getFeature: RouteHandler = async (_req, res, m) => {
  const [, owner, repo, id] = m;
  const feature = await (await projectFor(`${owner}/${repo}`)).features.get(id);
  if (!feature) return json(res, 404, { error: "feature not found" });
  return json(res, 200, feature);
};

// DELETE .../features/:id — remove the feature + its iterations (CASCADE).
const deleteFeature: RouteHandler = async (_req, res, m) => {
  const [, owner, repo, id] = m;
  const deleted = await (await projectFor(`${owner}/${repo}`)).features.delete(id);
  if (!deleted) return json(res, 404, { error: "feature not found" });
  return json(res, 200, { ok: true });
};

// GET .../features — list, optionally filtered by status.
const listFeatures: RouteHandler = async (_req, res, m) => {
  const [, owner, repo, queryString] = m;
  const status = new URLSearchParams(queryString ?? "").get("status") ?? undefined;
  const features = (await projectFor(`${owner}/${repo}`)).features;
  return json(res, 200, { features: await features.list(status as never) });
};

// POST .../features — create a draft + kick planning round 1.
const createFeature: RouteHandler = async (req, res, m) => {
  const [, owner, repo] = m;
  const body = (await readJsonBody(req)) as { title?: unknown; prompt?: unknown; parent_feature_id?: string };
  const { title, prompt } = enforceFeatureInput(body.title, body.prompt);
  const features = (await projectFor(`${owner}/${repo}`)).features;
  const feature = await features.create({ title, prompt, parentFeatureId: body.parent_feature_id });
  const row = await features.appendIteration(feature.id, null);
  const taskId = await kickPlanning(`${owner}/${repo}`, feature.id, row.iteration, prompt);
  await features.attachIterationTask(feature.id, row.iteration, taskId);
  return json(res, 201, { id: feature.id, task_id: taskId });
};

// Specific paths first; ONE_RE and LIST_RE are prefix-style catch-alls and must come last.
const ROUTES: { re: RegExp; method: string; handle: RouteHandler }[] = [
  { re: RESULT_RE, method: "POST", handle: postIterationResult },
  { re: ITERATIONS_RE, method: "POST", handle: postIteration },
  { re: FINALIZE_RE, method: "POST", handle: postFinalize },
  { re: SPLIT_RE, method: "POST", handle: postSplit },
  { re: ONE_RE, method: "DELETE", handle: deleteFeature },
  { re: ONE_RE, method: "GET", handle: getFeature },
  { re: LIST_RE, method: "GET", handle: listFeatures },
  { re: LIST_RE, method: "POST", handle: createFeature },
];

/** Resolve the handler for a request, or null when nothing matches. Pure — testable. */
export function matchFeaturesRoute(
  url: string,
  method: string,
): { handle: RouteHandler; m: RegExpMatchArray } | null {
  for (const route of ROUTES) {
    if (route.method !== method) continue;
    const m = url.match(route.re);
    if (m) return { handle: route.handle, m };
  }
  return null;
}

export async function handleFeaturesRoute(
  req: IncomingMessage,
  res: ServerResponse,
  _pool: Pool | null,
): Promise<void> {
  const matched = matchFeaturesRoute(req.url || "", req.method || "GET");
  if (!matched) return json(res, 404, { error: "not found" });
  try {
    await matched.handle(req, res, matched.m);
  } catch (err) {
    if (err instanceof ValidationError) return json(res, 400, { error: err.message });
    return json(res, 500, { error: err instanceof Error ? err.message : String(err) });
  }
}
