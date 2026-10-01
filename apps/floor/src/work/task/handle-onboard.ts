/** Onboard handler: ENROLS the repo — labels, the ingest callback, the verbatim scaffolding on the branch — then hands the ticket to the `onboard` assembly line, whose push node opens the one PR an onboarding produces. */

import { enrolRepo } from "@re-cinq/lore-shared/onboard/enrol-repo.js";
import { writeAuditLog } from "../../outbound/audit.js";
import { ensureTaskBranch } from "./ensure-task-branch.js";
import { dispatchAgentCr, type DispatchInput } from "./dispatch-agent-cr.js";

export async function handleOnboard(input: DispatchInput): Promise<void> {
  const { task, targetRepo, branchName, project } = input;

  await ensureTaskBranch(project.repo, branchName);
  // Reported before dispatch, so a repo that silently never calls back is visible even if the line then dies.
  const { committed, attention } = await enrolRepo(
    {
      repo: project.repo,
      settings: project.settings,
      issues: project.issues,
      audit: (entry) => writeAuditLog(entry),
    },
    { repo: targetRepo, branch: branchName, taskId: task.id },
  );

  await commentGapsOnTicket(input, attention);
  console.log(
    `[floor] Onboard: enrolled ${targetRepo} — ${committed.length} scaffold file(s) on ${branchName}; the onboard line takes the ticket from here`,
  );

  await dispatchAgentCr(input);
}

/** The ticket is the human surface an onboarding has before its PR exists; the comment is posted when there is something to say and a ticket to say it on. */
async function commentGapsOnTicket(
  input: DispatchInput,
  section: string,
): Promise<void> {
  const { issueNumber, project } = input;

  if (section === "" || issueNumber === null) {
    return;
  }
  const { issues } = project;

  await issues.comment(issueNumber, section);
}
