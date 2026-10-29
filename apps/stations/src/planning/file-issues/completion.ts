import type { DecompTask } from "@re-cinq/lore-shared/feature-planning/decomposition-result.js";
import type { PlanIssues } from "@re-cinq/lore-shared/feature-planning/plan-issues.js";
import { implementationEvidenceLink } from "@re-cinq/lore-shared/feature-planning/grounding.js";
import { statementsForTask } from "@re-cinq/lore-shared/spec-tickets/implementation-tasks.js";
import type { FilingContext, StationProject } from "./plan-issue-filing.js";

export async function completeImplementedTasks(
  project: StationProject,
  existing: PlanIssues,
  context: FilingContext,
): Promise<void> {
  await Promise.all(
    (context.completed ?? []).map(async (task) => {
      const issue = existing.tasks.get(task.id);

      if (issue?.state !== "open") {
        return;
      }
      await completionComment(project, issue.number, context, {
        id: task.id,
        body: completionEvidence(task, context),
      });
      await project.issues.close(issue.number, "completed");
    }),
  );
}

export async function completeStory(
  project: StationProject,
  existing: PlanIssues,
  context: FilingContext,
): Promise<void> {
  if (!context.nothingRemaining || existing.story?.state !== "open") {
    return;
  }
  const { number } = existing.story;

  await completionComment(project, number, context, {
    id: "story",
    body: "Every spec statement is implemented; nothing remains to ticket.",
  });
  await project.issues.close(number, "completed");
}

function completionEvidence(task: DecompTask, context: FilingContext): string {
  const { input, commit, statements = [] } = context;
  const evidence = statementsForTask(
    task,
    statements,
    input.params.spec_path,
  ).flatMap((statement) => statement.evidence);

  return [
    "This task is already implemented.",
    ...evidence.map(
      (entry) =>
        `- ${entry.text}: ${implementationEvidenceLink(input.repo, commit!, entry)}`,
    ),
  ].join("\n\n");
}

async function completionComment(
  project: StationProject,
  number: number,
  context: FilingContext,
  comment: { id: string; body: string },
): Promise<void> {
  const marker = `<!-- lore-implementation-completed: ${context.planId}/${comment.id}@${context.commit} -->`;
  const comments = await project.issues.listComments(number);

  if (!comments.some((entry) => entry.body.startsWith(marker))) {
    await project.issues.comment(number, `${marker}\n\n${comment.body}`);
  }
}
