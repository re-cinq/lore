/**
 * Generic output handler.
 *
 * Commits a single LLM-produced artifact to a per-task-type path and opens
 * a PR.
 */

import { generateArtifactCopy } from "../../adapters/artifact-copy.js";
import { projectFor } from "../../application/project-boot.js";
import { linkifyMarkdown } from "@re-cinq/lore-shared";
import { setStatus, insertEvent, issueRef, linkPrToIssue } from "./task-helpers.js";

// ── Output handlers ───────────────────────────────────────────────────

export async function handleGenericOutput(
  task: any,
  text: string,
  targetRepo: string,
  branchName: string,
  slug: string,
  issueNumber: number | null,
): Promise<void> {
  // Determine output file path based on task type
  let filePath: string;
  switch (task.task_type) {
    case "runbook":
      filePath = `runbooks/${slug}.md`;
      break;
    case "implementation":
      filePath = `src/${slug}.ts`;
      break;
    default:
      filePath = `output/${slug}.md`;
      break;
  }

  const project = await projectFor(targetRepo);
  await project.repo.createBranch(branchName);
  await project.repo.commitFile(branchName, filePath, text, `lore: add ${filePath}`);

  const copy = await generateArtifactCopy({
    kind: "pr",
    taskType: task.task_type,
    description: task.description,
    agentOutput: text,
    changedFiles: 1,
    repo: targetRepo,
  });
  const prBody = linkifyMarkdown(`${copy.body}\n\nOutput: \`${filePath}\``, {
    repo: targetRepo,
    branch: branchName,
    uiUrl: process.env.LORE_UI_URL,
  });
  const pr = await project.pulls.open(
    branchName,
    copy.title,
    `${prBody}${issueRef(issueNumber, task.id)}`,
  );
  await linkPrToIssue(targetRepo, issueNumber, pr.url);

  await setStatus(task.id, "pr-created", {
    pr_url: pr.url,
    pr_number: pr.number,
    target_branch: branchName,
  });
  await insertEvent(task.id, "running", "pr-created", {
    pr_url: pr.url,
  });

  console.log(`[agent] Task ${task.id} → PR ${pr.url}`);
}
