// One step of the escalation line: escalate() used to be one function (file Issue → audit-only fallback in a catch → notify) with no callers from #805 until this line existed. As two steps, the fallback becomes an EDGE — file-issue failing routes to notify exactly like succeeding does, since a failed Issue surface is precisely when the notification must carry the whole diagnostic.

import type { NodeResult } from "@re-cinq/lore-assembly-lines";
import {
  renderEscalationBody,
  type EscalateInput,
} from "@re-cinq/lore-shared/escalation/escalation-body.js";

export interface EscalationStepDeps {
  /** Everything the diagnostic is rendered from, assembled for this task. */
  escalationInput(taskId: string): Promise<EscalateInput>;
  createIssue(
    repo: string,
    title: string,
    body: string,
  ): Promise<{ number: number; url?: string }>;
  writeAudit(entry: Record<string, unknown>): Promise<void>;
  // Send at the escalation level. No channel argument: there is one level this station ever sends at, and the sole implementation ignored the parameter.
  notify(message: string): Promise<void>;
  /** How hard to try the Issue before degrading to audit-only. */
  retry?: { attempts: number; delayMs: number };
  /** The line's args, carrying what earlier steps produced. */
  params?: Record<string, string>;
}

const failed = (detail: string): NodeResult => ({
  outcome: "failed",
  failureClass: "unknown",
  failureDetail: detail.substring(0, 300),
});

async function fileIssue(
  input: EscalateInput,
  deps: EscalationStepDeps,
): Promise<NodeResult> {
  const title = `[lore] needs-human-help: ${input.reason} on ${input.branchName}`;

  const { attempts, delayMs } = deps.retry ?? { attempts: 3, delayMs: 1000 };
  let lastError = "";

  for (let attempt = 1; attempt <= attempts; attempt++) {
    try {
      const issue = await deps.createIssue(
        input.repo,
        title,
        renderEscalationBody(input),
      );

      return {
        outcome: "success",
        // Produced ARGS, not extras: args are merged into the line and reach notify as its params (extras route the walk and never arrive there). `issue_url` is set only when there is one — absent selects the audit-only text, so an empty string must not stand in.
        args: {
          ...(issue.url ? { issue_url: issue.url } : {}),
          issue_number: String(issue.number),
        },
      };
    } catch (err) {
      // Retried rather than degraded on the first refusal — audit_only is a legitimate outcome and LOOKS like one, so a single GitHub blip would quietly turn a real escalation into a Slack line.
      lastError = (err as Error).message;

      if (attempt < attempts) {
        await new Promise((resolve) => setTimeout(resolve, delayMs * attempt));
      }
    }
  }

  return failed(`could not open the issue: ${lastError}`);
}

interface FiledIssue {
  url: string | undefined;
  number: string;
}

// The number is the filed sentinel, not the url: a filed Issue always has a number while the url is optional — keying on the url would audit a real Issue as audit_only.
function filedIssue(deps: EscalationStepDeps): FiledIssue | undefined {
  const issueNumber = deps.params?.issue_number;

  return issueNumber
    ? { url: deps.params?.issue_url, number: issueNumber }
    : undefined;
}

function escalationAuditPayload(
  input: EscalateInput,
  issue: FiledIssue | undefined,
): Record<string, unknown> {
  return {
    branch_name: input.branchName,
    reason: input.reason,
    outcome: issue ? "issue_created" : "audit_only",
    ...(issue ? { issue_number: issue.number } : {}),
    ...(issue?.url ? { issue_url: issue.url } : {}),
  };
}

function escalationMessage(
  input: EscalateInput,
  issue: FiledIssue | undefined,
): string {
  if (!issue) {
    // No Issue to read, so the message IS the escalation: the same rendered body the Issue would have carried, not a bare diagnostic string.
    return `🚨 Lore needs human help (${input.reason}) on ${input.branchName} — Issue creation failed.\n\n${renderEscalationBody(input)}`;
  }

  return `🚨 Lore needs human help (${input.reason}) — ${issue.url ?? `issue #${issue.number}`}`;
}

async function notify(
  input: EscalateInput,
  deps: EscalationStepDeps,
): Promise<NodeResult> {
  const issue = filedIssue(deps);

  await deps.writeAudit({
    event_type: "escalation_issued",
    task_id: input.taskId,
    repo: input.repo,
    payload: escalationAuditPayload(input, issue),
  });

  await deps.notify(escalationMessage(input, issue));

  return { outcome: "success" };
}

export async function runEscalationStep(
  jobRef: string,
  taskId: string,
  deps: EscalationStepDeps,
): Promise<NodeResult> {
  const input = await deps.escalationInput(taskId);

  if (jobRef === "file-issue") {
    return fileIssue(input, deps);
  }

  if (jobRef === "notify") {
    return notify(input, deps);
  }

  return failed(`no escalation step named "${jobRef}"`);
}
