import type { PipelineTask } from "@re-cinq/lore-shared";
import {
  prFooter,
  type Project,
  type StationCompletion,
} from "@re-cinq/lore-shared";
import { generateArtifactCopy } from "../../outbound/artifact-copy.js";
import { setStatus, insertEvent } from "./task-helpers.js";

/** After a failed planning round, revert to 'draft' ONLY when no round ever produced a result — never badge a failed feature 'awaiting-input'. */
export async function revertFeatureAfterFailure(
  project: Pick<Project, "features">,
  featureId: string,
): Promise<void> {
  const { features } = project;
  const feature = await features.get(featureId);

  if (!feature) {
    return;
  }

  if (!feature.iterations.some((i) => i.gap_result)) {
    await features.transitionStatus(featureId, "draft").catch(() => {});
  }
}

/** Tail of a Station's captured output for a failure message — the cause of an exit lives in the output, not the code, so surface it. */
export function stationLogTail(
  output: string,
  maxLines = 40,
  maxChars = 3000,
): string {
  const trimmed = output.trim();

  if (!trimmed) {
    return "";
  }
  let tail = trimmed
    .split("\n")
    .filter((l) => l.trim().length > 0)
    .slice(-maxLines)
    .join("\n");

  if (tail.length > maxChars) {
    tail = `…${tail.slice(-maxChars)}`;
  }

  return tail;
}

interface FinalizeStationRunOpts {
  task: PipelineTask;
  targetRepo: string;
  branch: string;
  completion: StationCompletion;
  project: Project;
}

/** Finalize a synchronous (Docker) Station run inline — no loretask-watcher locally (ADR-028); mirrors the K8s watcher's post-completion behavior. */
export async function finalizeStationRun(
  opts: FinalizeStationRunOpts,
): Promise<void> {
  const { task, completion } = opts;

  if (completion.exitCode !== 0) {
    await handleStationExitFailure(opts);

    return;
  }

  const isPlanning = task.task_type === "feature-planning";

  if (!isPlanning && completion.changedFiles === 0) {
    await handleNoChangeCompletion(opts);

    return;
  }

  if (!isPlanning) {
    await openStationPr(opts);

    return;
  }

  await finalizePlanningResult(opts);
}

/** Surface the container's own logs — exit 128 is almost always a git/clone failure whose cause is only in the output. */
async function handleStationExitFailure(
  opts: FinalizeStationRunOpts,
): Promise<void> {
  const { task, completion, project } = opts;
  const tail = stationLogTail(completion.output);
  const reason = `Station exited ${completion.exitCode}.${tail ? `\n\n${tail}` : ""}`;

  await markFailedPlanningIteration(task, project);
  await setStatus(task.id, "failed", { failure_reason: reason });
  await insertEvent(task.id, "running", "failed", {
    reason: `station exit ${completion.exitCode}`,
    exit_code: completion.exitCode,
  });
}

async function markFailedPlanningIteration(
  task: PipelineTask,
  project: Project,
): Promise<void> {
  const ref = planningIterationRef(task);

  if (!ref) {
    return;
  }
  const { features } = project;

  await features
    .setIterationResult(ref.featureId, ref.iteration, null, "failed")
    .catch(() => {});
  await revertFeatureAfterFailure(project, ref.featureId);
}

/** The feature iteration this task is a planning round of, or null when it is not one. */
function planningIterationRef(
  task: PipelineTask,
): { featureId: string; iteration: number } | null {
  if (
    task.task_type !== "feature-planning" ||
    !task.context_bundle?.feature_id ||
    task.context_bundle.iteration == null
  ) {
    return null;
  }

  return {
    featureId: task.context_bundle.feature_id as string,
    iteration: task.context_bundle.iteration as number,
  };
}

/** Non-planning, no file changes → no PR. Just close the task out. */
async function handleNoChangeCompletion(
  opts: FinalizeStationRunOpts,
): Promise<void> {
  const { task, completion } = opts;

  await setStatus(task.id, "completed");
  await insertEvent(task.id, "running", "completed", {
    changedFiles: completion.changedFiles,
  });
}

/** The container pushed a branch — open the PR for it. */
async function openStationPr(opts: FinalizeStationRunOpts): Promise<void> {
  const { task, branch, project } = opts;
  const content = await stationPrContent(opts);
  const pr = await project.pulls.open(branch, {
    ...content,
    base: await project.repo.defaultBranch(),
    labels: ["needs-review"],
  });

  await setStatus(task.id, "pr-created", {
    pr_url: pr.url,
    pr_number: pr.number,
    target_branch: branch,
  });
  await insertEvent(task.id, "running", "pr-created", { pr_url: pr.url });
  // The feature's own move to `pr-open` is NOT done here — `spec-pr.ts` owns that transition (FR6.33).
}

/** Generated PR title and body, with the standard `Lore-Task:` footer already appended. */
async function stationPrContent(
  opts: FinalizeStationRunOpts,
): Promise<{ title: string; body: string }> {
  const { task, targetRepo, completion } = opts;
  const copy = await generateArtifactCopy({
    kind: "pr",
    taskType: task.task_type,
    description: task.description,
    agentOutput: completion.output,
    changedFiles: completion.changedFiles,
    repo: targetRepo,
  });
  const footer = prFooter({
    issueNumber: task.issue_number ?? undefined,
    taskId: task.id,
  });

  return { title: copy.title, body: `${copy.body}${footer}` };
}

/** feature-planning self-POSTs its GapResult; verify it landed — exit 0 with nothing posted must surface as a failure, not a silent stuck "analyzing". */
async function finalizePlanningResult(
  opts: FinalizeStationRunOpts,
): Promise<void> {
  const { task, project } = opts;
  const featureId = task.context_bundle?.feature_id as string | undefined;
  const iteration = task.context_bundle?.iteration as number | undefined;
  const row = await findPlanningIterationRow(project, featureId, iteration);

  if (isPlanningResultReady(row)) {
    await markPlanningResultReady(task, featureId, iteration);

    return;
  }
  await markPlanningResultMissing(opts, featureId, iteration);
}

function isPlanningResultReady(
  row: Awaited<ReturnType<typeof findPlanningIterationRow>>,
): boolean {
  return row?.status === "ready" && Boolean(row.gap_result);
}

async function findPlanningIterationRow(
  project: Project,
  featureId: string | undefined,
  iteration: number | undefined,
) {
  const feature = featureId ? await project.features.get(featureId) : null;

  return feature?.iterations.find((i) => i.iteration === iteration);
}

async function markPlanningResultReady(
  task: PipelineTask,
  featureId: string | undefined,
  iteration: number | undefined,
): Promise<void> {
  await setStatus(task.id, "completed");
  await insertEvent(task.id, "running", "completed", {
    feature_id: featureId,
    iteration,
  });
}

async function markPlanningResultMissing(
  opts: FinalizeStationRunOpts,
  featureId: string | undefined,
  iteration: number | undefined,
): Promise<void> {
  const { task, completion, project } = opts;

  if (featureId && iteration != null) {
    const { features } = project;

    await features
      .setIterationResult(featureId, iteration, null, "failed")
      .catch(() => {});
    await revertFeatureAfterFailure(project, featureId);
  }
  await setStatus(task.id, "failed", {
    failure_reason: planningNoResultReason(completion.output),
  });
  await insertEvent(task.id, "running", "failed", {
    reason: "planning posted no result",
  });
}

/** Exit 0 with nothing posted is a failure whose only evidence is the container's own tail. */
function planningNoResultReason(output: string): string {
  const tail = stationLogTail(output);

  return (
    `Planning run finished (exit 0) but posted no result — the agent did not produce a result.json the container could POST.` +
    (tail ? `\n\n${tail}` : "")
  );
}
