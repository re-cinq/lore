/** Onboard handler: generates Lore platform files (CLAUDE.md, AGENTS.md, ADRs, spec, CI, test-commands). */

import { enforceTrue } from "@re-cinq/lore-shared/lib/enforce.js";
import { writeEpisode } from "@re-cinq/lore-shared";
import { projectFor } from "../../outbound/project-boot.js";
import { memoryLifecycle, settings } from "../../outbound/queues.js";
import { fetchRepoContext } from "./repo-context.js";
import {
  setStatus,
  insertEvent,
  issueRef,
  linkPrToIssue,
} from "./task-helpers.js";
import type { TaskHandlerInput } from "./task-handler-input.js";
import { planOnboardFiles } from "./onboard-plan.js";
import {
  onboardAttentionSection,
  anyWorkflowsPermissionFailure,
} from "./onboard-attention.js";
import {
  configureIngestCallback,
  logIngestConfigResult,
} from "./onboard-ingest-callback.js";
import { commitOnboardFiles } from "./onboard-commit.js";
import {
  auditOnboardFailuresIfAny,
  createDispatchLabels,
} from "./onboard-audit.js";

export { ONBOARD_STATIC_FILES, ONBOARD_FILES } from "./onboard-content.js";

export async function handleOnboard({
  task,
  targetRepo,
  branchName,
  model,
  issueNumber,
}: TaskHandlerInput): Promise<void> {
  const run: OnboardingRun = {
    project: await projectFor(targetRepo),
    targetRepo,
    branchName,
    task,
    issueNumber,
  };
  const { committed, attention } = await prepareOnboarding(run, model);
  const pr = await openOnboardingPr({ ...run, committed, attention });

  await recordOnboardingPr(run, committed, pr);
}

/** The five facts every step of an onboarding needs. Threaded rather than re-listed: each step used to declare the same parameter block, and they drifted. */
interface OnboardingRun {
  project: Awaited<ReturnType<typeof projectFor>>;
  targetRepo: string;
  branchName: string;
  task: TaskHandlerInput["task"];
  issueNumber: TaskHandlerInput["issueNumber"];
}

/** Generates the onboarding files onto a fresh branch and applies the repo-level configuration. Returns what landed and what did not: an onboarding PR is worth opening even when some of it failed, as long as it says so. */
async function prepareOnboarding(
  run: OnboardingRun,
  model: string | undefined,
): Promise<{ committed: string[]; attention: string }> {
  const { project, branchName, task } = run;
  const plan = await planOnboarding(run.targetRepo);

  await project.repo.createBranch(branchName);

  const { committed, failures } = await commitOnboardFiles({
    project,
    branchName,
    task,
    model,
    ...plan,
  });
  const attention = await configureAndAudit({ ...run, failures });

  return { committed, attention };
}

/** Reads the repo once and decides what onboarding still owes it. */
async function planOnboarding(targetRepo: string): Promise<{
  contextStr: string;
  existingFiles: Set<string>;
  toGenerate: Awaited<ReturnType<typeof planOnboardFiles>>;
}> {
  const context = await loadOnboardContext(targetRepo);

  const existingFiles = new Set([
    ...context.tree,
    ...Object.keys(context.files),
  ]);
  const toGenerate = await planFilesToGenerate(targetRepo, {
    existingFiles,
    hasAdrs: context.tree.includes("adrs") || context.tree.includes("docs"),
  });

  return {
    contextStr: JSON.stringify(context, null, 2),
    existingFiles,
    toGenerate,
  };
}

/** One read of the repo, logged: the tree plus the fetched file set is what every later onboarding decision keys on. */
async function loadOnboardContext(targetRepo: string) {
  console.log(`[floor] Onboard: fetching context for ${targetRepo}...`);
  const context = await fetchRepoContext(targetRepo);

  console.log(
    `[floor] Onboard: ${context.tree.length} tree entries, ${Object.keys(context.files).length} files`,
  );

  return context;
}

/** A repo that already has every file is an error rather than an empty run, because an onboard PR with no files is indistinguishable from a broken one. */
async function planFilesToGenerate(
  targetRepo: string,
  survey: Parameters<typeof planOnboardFiles>[1],
): Promise<Awaited<ReturnType<typeof planOnboardFiles>>> {
  const toGenerate = await planOnboardFiles(targetRepo, survey);

  enforceTrue(
    toGenerate.length !== 0,
    Error,
    "All onboarding files already exist — nothing to generate",
  );

  console.log(`[floor] Onboard: generating ${toGenerate.length} files...`);

  return toGenerate;
}

/** What deciding an onboarding's attention section needs: the run itself, plus whatever failed while committing. */
interface OnboardAuditInput {
  project: Awaited<ReturnType<typeof projectFor>>;
  targetRepo: string;
  task: TaskHandlerInput["task"];
  failures: Parameters<typeof anyWorkflowsPermissionFailure>[0];
}

/** Runs BEFORE the PR is opened so its failures can be reported in the PR body — a repo that silently never calls back is the failure this exists to make visible. Everything that went wrong reaches the returned attention section, so the human reading the PR sees the gaps rather than discovering them later. */
async function configureAndAudit(input: OnboardAuditInput): Promise<string> {
  const { project, targetRepo, failures } = input;
  const configFailures = await configureIngestCallback(project);

  logIngestConfigResult(targetRepo, configFailures);

  const workflowsPermissionDenied = anyWorkflowsPermissionFailure(failures);

  await auditOnboardFailuresIfAny({
    ...input,
    configFailures,
    workflowsPermissionDenied,
  });

  return onboardAttentionSection({
    failures,
    configFailures,
    workflowsPermissionDenied,
  });
}

/** Everything that follows the PR existing: the Issue link, the repo record, the dispatch labels, the task status, and the episode. */
async function recordOnboardingPr(
  run: OnboardingRun,
  committed: string[],
  pr: { url: string; number: number },
): Promise<void> {
  const { project, targetRepo, task, issueNumber } = run;

  await linkPrToIssue(targetRepo, issueNumber, pr.url);

  // Update lore.repos with the PR URL
  await settings().setOnboardingPrUrl(targetRepo, pr.url);

  await createDispatchLabels(project, targetRepo);
  await markOnboardPrCreated(run, pr);

  captureOnboardEpisode(run, committed, pr.url);

  console.log(
    `[floor] Task ${task.id} → PR ${pr.url} (${committed.length} files)`,
  );
}

/** The task row and its event: the PR is the artifact, so `pr-created` is where an onboarding run stops being in flight. */
async function markOnboardPrCreated(
  run: OnboardingRun,
  pr: { url: string; number: number },
): Promise<void> {
  await setStatus(run.task.id, "pr-created", {
    pr_url: pr.url,
    pr_number: pr.number,
    target_branch: run.branchName,
  });
  await insertEvent(run.task.id, "running", "pr-created", { pr_url: pr.url });
}

/** Auto-capture onboarding as an episode; fire-and-forget, because a memory write must not fail a finished onboarding. */
function captureOnboardEpisode(
  run: OnboardingRun,
  committed: string[],
  prUrl: string,
): void {
  writeEpisode(
    { memory: memoryLifecycle() },
    {
      content: `Repo ${run.targetRepo} onboarded\nGenerated: ${committed.join(", ")}\nPR: ${prUrl}`,
      source: "ci",
      ref: `${run.targetRepo}/${run.task.id}`,
    },
  ).catch(() => {});
}

/** The onboarding PR, carrying an attention section when some part of the run needs a human — a missing workflows permission, a file that would not generate, an ingest callback that could not be configured. */
async function openOnboardingPr(input: {
  project: Awaited<ReturnType<typeof projectFor>>;
  branchName: string;
  targetRepo: string;
  task: TaskHandlerInput["task"];
  issueNumber: TaskHandlerInput["issueNumber"];
  committed: string[];
  attention: string;
}) {
  const { project, branchName, targetRepo, task, issueNumber, committed } =
    input;
  const fileList = committed.map((f) => `- \`${f}\``).join("\n");
  const attention = input.attention ? `\n${input.attention}` : "";

  return await project.pulls.open(branchName, {
    title: `lore: onboard ${targetRepo}`,
    body: `## Lore Onboarding\n\nThis PR adds Lore platform files for AI-powered development.\n\n**Files added:**\n${fileList}${attention}\n\nGenerated by Lore agent task \`${task.id}\`.${issueRef(issueNumber, task.id)}`,
    base: await project.repo.defaultBranch(),
    labels: ["lore-onboarding"],
  });
}
