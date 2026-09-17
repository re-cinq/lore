/** Onboard handler: ENROLS the repo — labels, the ingest callback, the verbatim scaffolding on the branch — then hands the ticket to the `onboard` assembly line, whose push node opens the one PR an onboarding produces. */

import { ensureTaskBranch } from "./ensure-task-branch.js";
import { dispatchAgentCr, type DispatchInput } from "./dispatch-agent-cr.js";
import {
  onboardAttentionSection,
  anyWorkflowsPermissionFailure,
} from "./onboard-attention.js";
import {
  configureIngestCallback,
  logIngestConfigResult,
} from "./onboard-ingest-callback.js";
import {
  auditOnboardFailuresIfAny,
  createDispatchLabels,
} from "./onboard-audit.js";
import { commitOnboardScaffold } from "./onboard-scaffold.js";

export async function handleOnboard(input: DispatchInput): Promise<void> {
  const { targetRepo, branchName, project } = input;

  await createDispatchLabels(project, targetRepo);
  const configFailures = await configureIngestCallback(project);

  logIngestConfigResult(targetRepo, configFailures);

  await ensureTaskBranch(project.repo, branchName);
  const { committed, failures } = await commitOnboardScaffold(
    project.repo,
    branchName,
  );

  await reportEnrolmentGaps(input, { failures, configFailures });
  console.log(
    `[floor] Onboard: enrolled ${targetRepo} — ${committed.length} scaffold file(s) on ${branchName}; the onboard line takes the ticket from here`,
  );

  await dispatchAgentCr(input);
}

/** Everything that went wrong enrolling reaches the audit log and the TICKET — the human surface an onboarding has before its PR exists. Reported before dispatch so a repo that silently never calls back is visible even if the line then dies. */
async function reportEnrolmentGaps(
  input: DispatchInput,
  gaps: EnrolmentGaps,
): Promise<void> {
  const { task, targetRepo } = input;
  const workflowsPermissionDenied = anyWorkflowsPermissionFailure(
    gaps.failures,
  );

  await auditOnboardFailuresIfAny({
    task,
    targetRepo,
    ...gaps,
    workflowsPermissionDenied,
  });
  await commentGapsOnTicket(
    input,
    onboardAttentionSection({ ...gaps, workflowsPermissionDenied }),
  );
}

/** What enrolment could not do: files that failed to commit, callback values that failed to set. */
interface EnrolmentGaps {
  failures: Parameters<typeof anyWorkflowsPermissionFailure>[0];
  configFailures: string[];
}

/** The ticket comment, when there is something to say and a ticket to say it on. */
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
