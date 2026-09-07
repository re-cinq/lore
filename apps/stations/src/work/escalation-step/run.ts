// Binds one escalation step to the ports this process holds — the composition root: the steps take everything they need, and here it becomes the real code host, the real audit log, and the real notification channels.

import type { NodeResult } from "@re-cinq/lore-assembly-lines";
import type { StationInput } from "@re-cinq/lore-shared/station-input.js";
import type { EscalateInput } from "@re-cinq/lore-shared/escalation/escalation-body.js";
import { runEscalationStep } from "./escalation-step.js";
import { projectFor } from "../../outbound/project-boot.js";

// Everything the diagnostic is rendered from, read once per step. The branch and reason ride in on the line's args — whoever decided to escalate knew them, and re-deriving them here would be a second opinion about why the task failed.
function escalationInputFrom(
  input: StationInput,
): (taskId: string) => Promise<EscalateInput> {
  // input.params is z.record(z.string()) — zod guarantees string VALUES, not that these specific keys were present in the wire JSON.
  const params = input.params as Record<string, string | undefined>;

  return async (taskId) => {
    return {
      taskId,
      repo: input.repo,
      branchName: params.branch_name ?? input.branch,
      // The reason rides in on args and is one of a closed set; an unrecognised one still renders, since a diagnostic with an odd heading beats no diagnostic.
      reason: (params.reason ?? "supervisor_panic") as EscalateInput["reason"],
      diagnostic: params.diagnostic ?? "",
      contributingRefs: [],
    };
  };
}

/** The three surfaces an escalation reaches, all through the same Project facade. Their failure modes differ on purpose: the Issue is the step's product, the audit entry is the durable record the dark-factory console reads, and the notification is best-effort — a Slack outage must not fail a step whose whole job is telling a human, but it must still be attempted. */
function escalationPorts(
  input: StationInput,
): Parameters<typeof runEscalationStep>[2] {
  return {
    escalationInput: escalationInputFrom(input),
    createIssue: async (repo, title, body) =>
      (await projectFor(repo)).issues.create(title, body, [
        "needs-human-help",
        "lore-managed",
      ]),
    writeAudit: async (entry) => {
      await (await projectFor(input.repo)).audit.write(entry as never);
    },
    notify: async (message: string) => {
      await (
        await projectFor(input.repo)
      ).notify
        .notify("escalation", message)
        .catch((err: Error) =>
          console.warn(
            `[escalation] notify failed for ${input.repo}:`,
            err.message,
          ),
        );
    },
    params: input.params,
  };
}

export async function runEscalationStepNode(
  input: StationInput,
): Promise<NodeResult> {
  const step =
    (input.params as Record<string, string | undefined>).job_ref ?? "";
  const taskId = input.task_id;

  if (!taskId) {
    return {
      outcome: "failed",
      failureClass: "unknown",
      failureDetail: `escalation step "${step}" has no task to act on`,
    };
  }

  return runEscalationStep(step, taskId, escalationPorts(input));
}
