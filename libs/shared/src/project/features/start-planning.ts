// Starts a feature's first planning round (sibling of refinement-round.ts, which covers later rounds) — this lifecycle's defects (#1462/1466/1468/1469/1470) were all values crossing the assemble/read process gap unchecked. Load-bearing order: round row appended before task creation (task carries the iteration id), task attached last (needs a task id).

import type { SectionAnswers } from "../../feature-planning/planning-prompt.js";

/** What a planning task carries about its round — the one place this shape is written; a contract between creator and dispatcher (a renamed key typechecks on both sides but reaches the pod absent). */
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
    // Both ride along rather than resolved here — only the Floor knows at dispatch whether this round resumes.
    ...(input.roundFeedback ? { round_feedback: input.roundFeedback } : {}),
    ...(input.resumeFromTask ? { resume_from_task: input.resumeFromTask } : {}),
  };
}

export interface StartPlanningInput {
  /** The owner/repo slug, verbatim — lands in target_repo and is cloned as github.com/<target_repo>.git; a bare name would clone nothing. */
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
