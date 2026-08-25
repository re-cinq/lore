/**
 * Bind one escalation step to the ports this process holds.
 *
 * The composition root for the escalation line: the steps take everything they
 * need, and this is where those become the real code host, the real audit log
 * and the real notification channels.
 */

import type { NodeResult } from "@re-cinq/lore-assembly-lines";
import type { StationInput } from "@re-cinq/lore-shared/station-input.js";
import type { EscalateInput } from "@re-cinq/lore-shared/escalation/escalation-body.js";
import { runEscalationStep } from "./escalation-step.js";
import { projectFor } from "../../kernel/project-boot.js";
import { taskStore } from "../../kernel/queues.js";

/**
 * Everything the diagnostic is rendered from, read once per step.
 *
 * The branch and the reason ride in on the line's args — whoever decided to
 * escalate knew them, and re-deriving them here would be a second opinion about
 * why the task failed.
 */
function escalationInputFrom(
  input: StationInput,
): (taskId: string) => Promise<EscalateInput> {
  return async (taskId) => {
    const row = await taskStore().getById(taskId);

    return {
      taskId,
      repo: input.repo,
      branchName: input.params.branch_name ?? input.branch,
      // The reason rides in on args and is one of a closed set; an unrecognised one
      // still renders, because a diagnostic with an odd heading beats no diagnostic.
      reason: (input.params.reason ??
        "supervisor_panic") as EscalateInput["reason"],
      diagnostic: input.params.diagnostic ?? "",
      taskDescription: row?.description ?? undefined,
      contributingRefs: [],
    };
  };
}

export async function runEscalationStepNode(
  input: StationInput,
): Promise<NodeResult> {
  const step = input.params.job_ref ?? "";
  const taskId = input.task_id;

  if (!taskId) {
    return {
      outcome: "failed",
      failureClass: "unknown",
      failureDetail: `escalation step "${step}" has no task to act on`,
    };
  }

  return runEscalationStep(step, taskId, {
    escalationInput: escalationInputFrom(input),
    createIssue: async (repo, title, body) =>
      (await projectFor(repo)).issues.create(title, body, [
        "needs-human-help",
        "lore-managed",
      ]),
    // pipeline.audit_log, through the same facade the Issue goes through — the
    // dark-factory console reads `escalation_issued` from there, and it is the
    // durable half of this step.
    writeAudit: async (entry) => {
      await (await projectFor(input.repo)).audit.write(entry as never);
    },
    // Notification is best-effort by design: the audit entry above is the
    // durable record, and a Slack outage must not fail the step that carries
    // the diagnostic.
    notify: async () => {},
    params: input.params,
  });
}
