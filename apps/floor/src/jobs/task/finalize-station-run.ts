import type { PipelineTask } from "@re-cinq/lore-shared";
import {
  prFooter,
  type Project,
  type StationCompletion,
} from "@re-cinq/lore-shared";
import { generateArtifactCopy } from "../lib/artifact-copy.js";
import { setStatus, insertEvent } from "./task-helpers.js";

/** After a failed planning round, revert to 'draft' ONLY when no round ever produced a result — never badge a failed feature 'awaiting-input'. */
export async function revertFeatureAfterFailure(
  project: Pick<Project, "features">,
  featureId: string,
): Promise<void> {
  const feature = await project.features.get(featureId);

  if (!feature) {
    return;
  }

  if (!feature.iterations.some((i) => i.gap_result)) {
    await project.features.transitionStatus(featureId, "draft").catch(() => {});
  }
}

/** Tail of a Station's captured output for a failure message — the cause of an exit lives in the output, not the code, so surface it. */
export function stationLogTail(
  output: string,
  maxLines = 40,
  maxChars = 3000,
): string {
  const trimmed = (output ?? "").trim();

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

/** Finalize a synchronous (Docker) Station run inline — no loretask-watcher locally (ADR-028); mirrors the K8s watcher's post-completion behavior. */
export async function finalizeStationRun(opts: {
  task: PipelineTask;
  targetRepo: string;
  branch: string;
  completion: StationCompletion;
  project: Project;
}): Promise<void> {
  const { task, targetRepo, branch, completion, project } = opts;

  if (completion.exitCode !== 0) {
    // Surface the container's own logs — exit 128 is almost always a git/clone failure whose cause is only in the output.
    const tail = stationLogTail(completion.output);
    const reason = `Station exited ${completion.exitCode}.${tail ? `\n\n${tail}` : ""}`;

    await markFailedPlanningIteration(task, project);
    await setStatus(task.id, "failed", { failure_reason: reason });
    await insertEvent(task.id, "running", "failed", {
      reason: `station exit ${completion.exitCode}`,
      exit_code: completion.exitCode,
    });

    return;
  }

  // Non-planning, no file changes → no PR. Just close the task out.
  if (task.task_type !== "feature-planning" && completion.changedFiles === 0) {
    await setStatus(task.id, "completed");
    await insertEvent(task.id, "running", "completed", {
      changedFiles: completion.changedFiles,
    });

    return;
  }

  if (task.task_type !== "feature-planning") {
    // The container pushed a branch — open the PR for it.
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
    const pr = await project.pulls.open(branch, {
      title: copy.title,
      body: `${copy.body}${footer}`,
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
    return;
  }

  // feature-planning self-POSTs its GapResult; verify it landed — exit 0 with nothing posted must surface as a failure, not a silent stuck "analyzing".
  const featureId = task.context_bundle?.feature_id as string | undefined;
  const iteration = task.context_bundle?.iteration as number | undefined;
  const feature = featureId ? await project.features.get(featureId) : null;
  const row = feature?.iterations.find((i) => i.iteration === iteration);

  if (row?.status === "ready" && row.gap_result) {
    await setStatus(task.id, "completed");
    await insertEvent(task.id, "running", "completed", {
      feature_id: featureId,
      iteration,
    });

    return;
  }
  const tail = stationLogTail(completion.output);
  const reason =
    `Planning run finished (exit 0) but posted no result — the agent did not produce a result.json the container could POST.` +
    (tail ? `\n\n${tail}` : "");

  if (featureId && iteration != null) {
    await project.features
      .setIterationResult(featureId, iteration, null, "failed")
      .catch(() => {});
    await revertFeatureAfterFailure(project, featureId);
  }
  await setStatus(task.id, "failed", { failure_reason: reason });
  await insertEvent(task.id, "running", "failed", {
    reason: "planning posted no result",
  });
}

async function markFailedPlanningIteration(
  task: PipelineTask,
  project: Project,
): Promise<void> {
  if (
    task.task_type !== "feature-planning" ||
    !task.context_bundle?.feature_id ||
    task.context_bundle?.iteration == null
  ) {
    return;
  }
  await project.features
    .setIterationResult(
      task.context_bundle.feature_id as string,
      task.context_bundle.iteration as number,
      null,
      "failed",
    )
    .catch(() => {});
  await revertFeatureAfterFailure(
    project,
    task.context_bundle.feature_id as string,
  );
}
