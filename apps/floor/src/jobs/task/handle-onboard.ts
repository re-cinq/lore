/** Onboard handler: generates Lore platform files (CLAUDE.md, AGENTS.md, ADRs, spec, CI, test-commands). */

import { enforceTrue } from "@re-cinq/lore-shared/lib/enforce.js";
import { writeEpisode } from "@re-cinq/lore-shared";
import { projectFor } from "../../composition/project-boot.js";
import { memoryLifecycle, settings } from "../../kernel/queues.js";
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
  const project = await projectFor(targetRepo);

  // 1. Pre-fetch repo context
  console.log(`[floor] Onboard: fetching context for ${targetRepo}...`);
  const context = await fetchRepoContext(targetRepo);
  const contextStr = JSON.stringify(context, null, 2);

  console.log(
    `[floor] Onboard: ${context.tree.length} tree entries, ${Object.keys(context.files).length} files`,
  );

  // 2. Determine which files already exist
  const existingFiles = new Set([
    ...context.tree,
    ...Object.keys(context.files),
  ]);

  // Check subdirectories
  const hasAdrs =
    context.tree.includes("adrs") || context.tree.includes("docs");

  const toGenerate = await planOnboardFiles(targetRepo, {
    existingFiles,
    hasAdrs,
  });

  enforceTrue(
    toGenerate.length !== 0,
    Error,
    "All onboarding files already exist — nothing to generate",
  );

  console.log(`[floor] Onboard: generating ${toGenerate.length} files...`);

  // 4. Create branch
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

  // Configure ingest callback before opening PR so failures can be reported; never write empty vars
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
