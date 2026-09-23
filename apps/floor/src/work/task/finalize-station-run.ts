import type { PipelineTask } from "@re-cinq/lore-shared";
import {
  prFooter,
  type Project,
  type StationCompletion,
} from "@re-cinq/lore-shared";
import { generateArtifactCopy } from "../../outbound/artifact-copy.js";
import { setStatus, insertEvent } from "./task-helpers.js";

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
  const { completion } = opts;

  if (completion.exitCode !== 0) {
    await handleStationExitFailure(opts);

    return;
  }

  if (completion.changedFiles === 0) {
    await handleNoChangeCompletion(opts);

    return;
  }
  await openStationPr(opts);
}

/** Surface the container's own logs — exit 128 is almost always a git/clone failure whose cause is only in the output. */
async function handleStationExitFailure(
  opts: FinalizeStationRunOpts,
): Promise<void> {
  const { task, completion } = opts;
  const tail = stationLogTail(completion.output);
  const reason = `Station exited ${completion.exitCode}.${tail ? `\n\n${tail}` : ""}`;

  await setStatus(task.id, "failed", { failure_reason: reason });
  await insertEvent(task.id, "running", "failed", {
    reason: `station exit ${completion.exitCode}`,
    exit_code: completion.exitCode,
  });
}

/** No file changes → no PR. Just close the task out. */
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
