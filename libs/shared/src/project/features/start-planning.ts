/**
 * Start a feature's first planning round.
 *
 * The sequence, not the HTTP around it — the sibling of
 * {@link ./refinement-round.ts}, which covers every round after this one. Both
 * exist because this lifecycle assembles values in one process and reads them
 * in another, and every defect it has produced (#1462, #1466, #1468, #1469,
 * #1470) was a value that crossed that gap with nothing asserting the two ends
 * agreed.
 *
 * One ordering here is load-bearing and asserted rather than described: the
 * round row is appended BEFORE the task is created, because the task carries
 * the iteration number it belongs to — kicking first would name a round that
 * does not exist yet. The task is attached last, because only then is there a
 * task id to attach.
 */

import type { SectionAnswers } from "../../feature-planning/planning-prompt.js";

/**
 * What a planning task carries about the round it is running.
 *
 * The one place this shape is written. It is a CONTRACT between whoever creates
 * the task and the Floor that dispatches it: a key renamed on one side
 * typechecks cleanly on both and reaches the pod as an absent value.
 */
export interface PlanningArgsInput {
  featureId: string;
  iteration: number;
  /** The author's answers, composed — present from round 2 onward. */
  roundFeedback?: string;
  /** The task this round continues, when it continues one. */
  resumeFromTask?: string | null;
}

export function planningTaskArgs(
  input: PlanningArgsInput,
): Record<string, unknown> {
  return {
    feature_id: input.featureId,
    iteration: input.iteration,
    // Both ride along rather than being resolved here: only the Floor knows at
    // dispatch whether this round resumes, so neither may be dropped early.
    ...(input.roundFeedback ? { round_feedback: input.roundFeedback } : {}),
    ...(input.resumeFromTask ? { resume_from_task: input.resumeFromTask } : {}),
  };
}

export interface StartPlanningInput {
  /** The `owner/repo` slug, verbatim — it lands in `target_repo` and is cloned
   *  as `github.com/<target_repo>.git`, so a bare name would clone nothing. */
  repo: string;
  title: string;
  prompt: string;
  parentFeatureId?: string;
}

export interface StartPlanningDeps {
  createFeature(input: {
    title: string;
    prompt: string;
    parentFeatureId?: string;
  }): Promise<{ id: string }>;
  appendIteration(
    featureId: string,
    answers: SectionAnswers | null,
  ): Promise<{ iteration: number }>;
  /** Create the planning task and return its id. */
  createPlanningTask(input: {
    repo: string;
    description: string;
    args: Record<string, unknown>;
  }): Promise<string>;
  attachIterationTask(
    featureId: string,
    iteration: number,
    taskId: string,
  ): Promise<void>;
}

export interface StartPlanningResult {
  featureId: string;
  iteration: number;
  taskId: string;
}

export async function startFeaturePlanning(
  input: StartPlanningInput,
  deps: StartPlanningDeps,
): Promise<StartPlanningResult> {
  const feature = await deps.createFeature({
    title: input.title,
    prompt: input.prompt,
    parentFeatureId: input.parentFeatureId,
  });
  const row = await deps.appendIteration(feature.id, null);
  const taskId = await deps.createPlanningTask({
    repo: input.repo,
    description: input.prompt,
    args: planningTaskArgs({ featureId: feature.id, iteration: row.iteration }),
  });

  await deps.attachIterationTask(feature.id, row.iteration, taskId);

  return { featureId: feature.id, iteration: row.iteration, taskId };
}
