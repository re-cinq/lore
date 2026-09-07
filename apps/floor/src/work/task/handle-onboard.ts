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

/** Reads the repo once and decides what onboarding still owes it. A repo that already has every file is an error rather than an empty run, because an onboard PR with no files is indistinguishable from a broken one. */
async function planOnboarding(targetRepo: string): Promise<{
  contextStr: string;
  existingFiles: Set<string>;
  toGenerate: Awaited<ReturnType<typeof planOnboardFiles>>;
}> {
  console.log(`[floor] Onboard: fetching context for ${targetRepo}...`);
  const context = await fetchRepoContext(targetRepo);

  console.log(
    `[floor] Onboard: ${context.tree.length} tree entries, ${Object.keys(context.files).length} files`,
  );

  const existingFiles = new Set([
    ...context.tree,
    ...Object.keys(context.files),
  ]);
  const toGenerate = await planOnboardFiles(targetRepo, {
    existingFiles,
    hasAdrs: context.tree.includes("adrs") || context.tree.includes("docs"),
  });

  enforceTrue(
    toGenerate.length !== 0,
    Error,
    "All onboarding files already exist — nothing to generate",
  );

  console.log(`[floor] Onboard: generating ${toGenerate.length} files...`);

  return {
    contextStr: JSON.stringify(context, null, 2),
    existingFiles,
    toGenerate,
  };
}

/** Runs BEFORE the PR is opened so its failures can be reported in the PR body — a repo that silently never calls back is the failure this exists to make visible. */
async function configureAndAudit(input: {
  project: Awaited<ReturnType<typeof projectFor>>;
  targetRepo: string;
  task: TaskHandlerInput["task"];
  failures: Parameters<typeof anyWorkflowsPermissionFailure>[0];
}): Promise<{ configFailures: string[]; workflowsPermissionDenied: boolean }> {
  const { project, targetRepo, task, failures } = input;
  const configFailures = await configureIngestCallback(project);

  logIngestConfigResult(targetRepo, configFailures);

  const workflowsPermissionDenied = anyWorkflowsPermissionFailure(failures);

  await auditOnboardFailuresIfAny({
    task,
    targetRepo,
    failures,
    configFailures,
    workflowsPermissionDenied,
  });

  return { configFailures, workflowsPermissionDenied };
}

export async function handleOnboard({
  task,
  targetRepo,
  branchName,
  model,
  issueNumber,
}: TaskHandlerInput): Promise<void> {
  const project = await projectFor(targetRepo);
  const { contextStr, existingFiles, toGenerate } =
    await planOnboarding(targetRepo);

  await project.repo.createBranch(branchName);

  const { committed, failures } = await commitOnboardFiles({
    project,
    branchName,
    existingFiles,
    contextStr,
    task,
    model,
    toGenerate,
  });

  const { configFailures, workflowsPermissionDenied } = await configureAndAudit(
    { project, targetRepo, task, failures },
  );

  const pr = await openOnboardingPr({
    project,
    branchName,
    targetRepo,
    task,
    issueNumber,
    committed,
    attention: onboardAttentionSection(
      failures,
      configFailures,
      workflowsPermissionDenied,
    ),
  });

  await recordOnboardingPr({
    project,
    targetRepo,
    branchName,
    task,
    issueNumber,
    committed,
    pr,
  });
}

/** Everything that follows the PR existing: the Issue link, the repo record, the dispatch labels, the task status, and the episode. */
async function recordOnboardingPr(input: {
  project: Awaited<ReturnType<typeof projectFor>>;
  targetRepo: string;
  branchName: string;
  task: TaskHandlerInput["task"];
  issueNumber: TaskHandlerInput["issueNumber"];
  committed: string[];
  pr: { url: string; number: number };
}): Promise<void> {
  const { project, targetRepo, branchName, task, issueNumber, committed, pr } =
    input;

  await linkPrToIssue(targetRepo, issueNumber, pr.url);

  // Update lore.repos with the PR URL
  await settings().setOnboardingPrUrl(targetRepo, pr.url);

  await createDispatchLabels(project, targetRepo);

  await setStatus(task.id, "pr-created", {
    pr_url: pr.url,
    pr_number: pr.number,
    target_branch: branchName,
  });
  await insertEvent(task.id, "running", "pr-created", { pr_url: pr.url });

  // Auto-capture onboarding as episode
  writeEpisode(
    { memory: memoryLifecycle() },
    {
      content: `Repo ${targetRepo} onboarded\nGenerated: ${committed.join(", ")}\nPR: ${pr.url}`,
      source: "ci",
      ref: `${targetRepo}/${task.id}`,
    },
  ).catch(() => {});

  console.log(
    `[floor] Task ${task.id} → PR ${pr.url} (${committed.length} files)`,
  );
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
  const { project, branchName, targetRepo, task, issueNumber } = input;
  const fileList = input.committed.map((f) => `- \`${f}\``).join("\n");
  const attention = input.attention ? `\n${input.attention}` : "";

  return await project.pulls.open(branchName, {
    title: `lore: onboard ${targetRepo}`,
    body: `## Lore Onboarding\n\nThis PR adds Lore platform files for AI-powered development.\n\n**Files added:**\n${fileList}${attention}\n\nGenerated by Lore agent task \`${task.id}\`.${issueRef(issueNumber, task.id)}`,
    base: await project.repo.defaultBranch(),
    labels: ["lore-onboarding"],
  });
}
