// What starting and accepting a planning round does; the routes say where it is reachable.

import type { Request } from "@hapi/hapi";
import type { Pool } from "pg";
import { composePlanningPrompt } from "@re-cinq/lore-shared/feature-planning/planning-prompt.js";
import { parseSectionAnswers } from "@re-cinq/lore-shared/feature-planning/feature-input.js";
import {
  roundInFlight,
  canFinalize,
  latestReadyGap,
} from "@re-cinq/lore-shared/project/features/features-port.js";
import { findParkedAuthorNode } from "@re-cinq/lore-shared/project/features/planning-run.js";
import { startRefinementRound } from "@re-cinq/lore-shared/project/features/refinement-round.js";
import { reportToParkedNode } from "@re-cinq/lore-shared/project/assembly-runs/parked-node.js";
import { enforceTrue } from "@re-cinq/lore-shared/lib/enforce.js";
import { apiError } from "../../http/api-error.js";
import { eventReporterFor } from "../event-reporter.js";
import { projectFor } from "../../../outbound/project-boot.js";
import { runIdBothSpellings } from "./features-schema.js";
import { repoOf } from "./feature-route-support.js";

/** How the shared round sequencer reaches this deployment: the failures it raises become HTTP statuses here, and its writes go through the repo's own project facade. */
function roundDeps(
  getPool: () => Pool | null,
  project: Awaited<ReturnType<typeof projectFor>>,
): Parameters<typeof startRefinementRound>[2] {
  return {
    invalidBasis: apiError(400),
    notParked: (runId) => apiError(409, runIdBothSpellings(runId)),
    parkedNode: (featureId) =>
      findParkedAuthorNode(project.assemblyRuns, featureId),
    appendIteration: (featureId, roundAnswers, basisIteration) =>
      project.features.appendIteration(featureId, roundAnswers, basisIteration),
    report: (target, outcome, args) =>
      reportToParkedNode(eventReporterFor(getPool()), target, {
        outcome,
        args,
      }),
  };
}

/** ONE planning round per feature: a second start while one is in flight is refused with the round that holds it, not queued. An orphaned `running` past its window no longer counts as in flight. */
export async function startPlanningRound(
  getPool: () => Pool | null,
  request: Request,
): Promise<{ code: number; body: object }> {
  const repo = repoOf(request.params);
  const id = request.params.id;
  const body = request.payload as {
    user_answers?: unknown;
    from_iteration?: unknown;
  };
  const project = await projectFor(repo);
  const feature = await project.features.get(id);

  enforceTrue(feature, apiError(404), "feature not found");

  const inFlight = roundInFlight(feature.iterations, Date.now());

  if (inFlight) {
    return {
      code: 409,
      body: {
        error: `A planning round (round ${inFlight.iteration}) is already running for this feature — wait for it to finish before starting another.`,
        iteration: inFlight.iteration,
      },
    };
  }

  // Sequence logic lives in shared; this contributes only the HTTP status mapping.
  const round = await startRefinementRound(
    feature,
    {
      answers: parseSectionAnswers(body.user_answers),
      // Rewind is author-named; the basis is resolved either way, and conflating them breaks rewind.
      rewoundTo:
        typeof body.from_iteration === "number"
          ? body.from_iteration
          : undefined,
    },
    roundDeps(getPool, project),
  );

  return {
    code: 202,
    body: {
      iteration: round.iteration,
      ...runIdBothSpellings(round.runId),
      task_id: null,
    },
  };
}

/** Accepting a plan reports SUCCESS to the node the line is parked on, so the spec work runs as an edge of the same line rather than a new one. Two structural guards catch a double-click — the feature's state, and whether anything is actually parked — and the refusal names the run so the author can see which one. */
export async function acceptPlan(
  getPool: () => Pool | null,
  request: Request,
): Promise<{ lineId: string }> {
  const repo = repoOf(request.params);
  const id = request.params.id;
  const body = request.payload as { user_answers?: unknown };
  const project = await projectFor(repo);
  const feature = await project.features.get(id);

  enforceTrue(feature, apiError(404), "feature not found");
  enforceTrue(
    canFinalize(feature.status),
    apiError(409),
    `cannot finalize a feature in '${feature.status}' state`,
  );

  const { runId, parked } = await findParkedAuthorNode(
    project.assemblyRuns,
    id,
  );

  enforceTrue(
    parked,
    apiError(409, runIdBothSpellings(runId)),
    "no plan is waiting to be accepted — this feature's line is not parked on the author",
  );
  await reportToParkedNode(eventReporterFor(getPool()), parked, {
    outcome: "success",
    args: {
      // Tail nodes read `description`; a shallow merge would leave refine's brief in place (#1470).
      description: composePlanningPrompt({
        title: feature.title,
        originalPrompt: feature.original_prompt,
        priorGap: latestReadyGap(feature.iterations),
        // Accept carries answers like refine does; dropping them loses author feedback.
        answers: parseSectionAnswers(body.user_answers),
      }),
      // Omitted keys survive a shallow merge, so these are nulled to clear refine's leftovers.
      round_feedback: null,
      resume_from_iteration: null,
    },
  });

  return parked;
}
