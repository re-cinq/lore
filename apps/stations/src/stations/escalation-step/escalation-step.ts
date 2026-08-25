/**
 * One step of the escalation line.
 *
 * `escalate()` used to be a single function that filed the Issue, fell back to
 * an audit-only path when GitHub refused, and notified — with the fallback
 * living in a catch block. It also had no callers from #805 until this line, so
 * none of it ran.
 *
 * As two steps the fallback becomes an EDGE: `file-issue` failing routes to
 * `notify` exactly as succeeding does, because a failure to reach the Issue
 * surface is precisely when the notification carries the whole diagnostic. Each
 * step is a recorded visit rather than a log line.
 */

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
  notify(message: string, channel: string): Promise<void>;
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

  try {
    const issue = await deps.createIssue(
      input.repo,
      title,
      renderEscalationBody(input),
    );

    return {
      outcome: "success",
      // Carried in extras so `notify` can name the Issue. Absent is the signal
      // that the Issue surface failed, which is what selects the audit-only text.
      extras: {
        issue_url: issue.url ?? "",
        issue_number: String(issue.number),
      },
    };
  } catch (err) {
    return failed(`could not open the issue: ${(err as Error).message}`);
  }
}

async function notify(
  input: EscalateInput,
  deps: EscalationStepDeps,
): Promise<NodeResult> {
  const issueUrl = deps.params?.issue_url;
  const filed = Boolean(issueUrl);

  await deps.writeAudit({
    event_type: "escalation_issued",
    task_id: input.taskId,
    repo: input.repo,
    payload: {
      branch_name: input.branchName,
      reason: input.reason,
      outcome: filed ? "issue_created" : "audit_only",
      ...(filed ? { issue_url: issueUrl } : {}),
    },
  });

  await deps.notify(
    filed
      ? `🚨 Lore needs human help (${input.reason}) — ${issueUrl}`
      : // No Issue to point at, so the message carries the diagnostic itself.
        `🚨 Lore needs human help (${input.reason}) on ${input.branchName}\n\n${input.diagnostic ?? ""}`,
    "escalation",
  );

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
