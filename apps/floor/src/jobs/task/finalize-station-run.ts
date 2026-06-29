import { prFooter, type Project, type StationCompletion } from "@re-cinq/lore-shared";
import { query } from "../../kernel/db.js";
import { generateArtifactCopy } from "../platform/artifact-copy.js";
import { setStatus, insertEvent } from "./task-helpers.js";

/**
 * After a failed planning round, set the feature back to 'draft' ONLY when no
 * round ever produced a result — otherwise leave the prior status (the earlier
 * analysis still stands; the wizard shows it). Never badge a failed feature
 * 'awaiting-input' — that implies a result is waiting for the user.
 */
export async function revertFeatureAfterFailure(project: Project, featureId: string): Promise<void> {
  const feature = await project.features.get(featureId);
  if (!feature) return;
  if (!feature.iterations.some((i) => i.gap_result)) {
    await project.features.transitionStatus(featureId, "draft").catch(() => {});
  }
}

/**
 * The tail of a Station's captured output, for a failure message — last
 * non-empty lines, bounded. Pure. The cause of an exit (e.g. a git "Repository
 * not found" on 128) lives in the output, not the code, so surface it.
 */
export function stationLogTail(output: string, maxLines = 40, maxChars = 3000): string {
  const trimmed = (output ?? "").trim();
  if (!trimmed) return "";
  let tail = trimmed
    .split("\n")
    .filter((l) => l.trim().length > 0)
    .slice(-maxLines)
    .join("\n");
  if (tail.length > maxChars) tail = `…${tail.slice(-maxChars)}`;
  return tail;
}

/**
 * Finalize a synchronous (Docker) Station run inline — there is no
 * loretask-watcher locally (ADR-028). The K8s path keeps using the watcher; this
 * mirrors its post-completion behavior for the local container:
 *  - non-zero exit → task failed
 *  - feature-planning / no file changes → just complete (planning self-POSTed its result)
 *  - changes pushed → open the PR for the branch, update the task, and (for
 *    feature-finalize) flip the feature to pr-open.
 */
export async function finalizeStationRun(opts: {
  task: any;
  targetRepo: string;
  branch: string;
  completion: StationCompletion;
  project: Project;
}): Promise<void> {
  const { task, targetRepo, branch, completion, project } = opts;

  if (completion.exitCode !== 0) {
    // Surface the container's own logs (exit 128 is almost always a git/clone
    // failure whose cause is only in the output) so the wizard shows WHY.
    const tail = stationLogTail(completion.output);
    const reason = `Station exited ${completion.exitCode}.${tail ? `\n\n${tail}` : ""}`;
    // Keep the feature row consistent: a failed planning round must mark its
    // iteration failed (not leave it 'running') + drop the feature to awaiting-input.
    if (task.task_type === "feature-planning" && task.context_bundle?.feature_id && task.context_bundle?.iteration != null) {
      await project.features
        .setIterationResult(task.context_bundle.feature_id, task.context_bundle.iteration, null, "failed")
        .catch(() => {});
      await revertFeatureAfterFailure(project, task.context_bundle.feature_id);
    }
    await setStatus(task.id, "failed", { failure_reason: reason });
    await insertEvent(task.id, "running", "failed", {
      reason: `station exit ${completion.exitCode}`,
      exit_code: completion.exitCode,
    });
    return;
  }

  // feature-planning self-POSTs its GapResult from inside the container. Verify it
  // actually landed — a run that exits 0 but posts nothing must surface as a
  // failure (with logs), not a silent "completed" that leaves the wizard stuck
  // "analyzing" forever.
  if (task.task_type === "feature-planning") {
    const featureId = task.context_bundle?.feature_id as string | undefined;
    const iteration = task.context_bundle?.iteration as number | undefined;
    const feature = featureId ? await project.features.get(featureId) : null;
    const row = feature?.iterations.find((i) => i.iteration === iteration);
    if (row?.status === "ready" && row.gap_result) {
      await setStatus(task.id, "completed");
      await insertEvent(task.id, "running", "completed", { feature_id: featureId, iteration });
      return;
    }
    const tail = stationLogTail(completion.output);
    const reason =
      `Planning run finished (exit 0) but posted no result — the agent did not produce a result.json the container could POST.` +
      (tail ? `\n\n${tail}` : "");
    if (featureId && iteration != null) {
      await project.features.setIterationResult(featureId, iteration, null, "failed").catch(() => {});
      await revertFeatureAfterFailure(project, featureId);
    }
    await setStatus(task.id, "failed", { failure_reason: reason });
    await insertEvent(task.id, "running", "failed", { reason: "planning posted no result" });
    return;
  }

  // Non-planning, no file changes → no PR. Just close the task out.
  if (completion.changedFiles === 0) {
    await setStatus(task.id, "completed");
    await insertEvent(task.id, "running", "completed", { changedFiles: completion.changedFiles });
    return;
  }

  // The container pushed a branch — open the PR for it.
  const copy = await generateArtifactCopy({
    kind: "pr",
    taskType: task.task_type,
    description: task.description,
    agentOutput: completion.output,
    changedFiles: completion.changedFiles,
    repo: targetRepo,
  });
  const footer = prFooter({ issueNumber: task.issue_number ?? undefined, taskId: task.id });
  const pr = await project.pulls.open(branch, copy.title, `${copy.body}${footer}`, "main", ["needs-review"]);

  await query(
    `UPDATE pipeline.tasks SET status='pr-created', pr_url=$1, pr_number=$2, target_branch=$3, updated_at=now() WHERE id=$4`,
    [pr.url, pr.number, branch, task.id],
  );
  await insertEvent(task.id, "running", "pr-created", { pr_url: pr.url });

  // feature-finalize: link the PR back to the feature row (Features tab → pr-open).
  if (task.task_type === "feature-finalize" && task.context_bundle?.feature_id) {
    const slug = task.context_bundle.slug as string | undefined;
    await project.features.transitionStatus(task.context_bundle.feature_id, "pr-open", {
      spec_pr_url: pr.url,
      spec_pr_number: pr.number,
      ...(slug ? { spec_path: `specs/${slug}/spec.md` } : {}),
    });
  }
}
