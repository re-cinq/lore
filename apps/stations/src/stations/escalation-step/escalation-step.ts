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
  /** Send at the escalation level. No channel argument: there is one level this
   *  station ever sends at, and the sole implementation ignored the parameter. */
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
        // Produced ARGS, not extras: args are merged into the line and reach
        // `notify` as its params — extras route the walk and never arrive there.
        // `issue_url` is set only when there is one; absent is the signal that
        // selects the audit-only text, so an empty string must not stand in.
        args: {
          ...(issue.url ? { issue_url: issue.url } : {}),
          issue_number: String(issue.number),
        },
      };
    } catch (err) {
      // Retried rather than degraded on the first refusal. Falling through to
      // audit_only is a legitimate outcome and LOOKS like one, so a single blip
      // from GitHub would quietly turn a real escalation into a Slack line.
      lastError = (err as Error).message;

      if (attempt < attempts) {
        await new Promise((resolve) => setTimeout(resolve, delayMs * attempt));
      }
    }
  }

  return failed(`could not open the issue: ${lastError}`);
}

async function notify(
  input: EscalateInput,
  deps: EscalationStepDeps,
): Promise<NodeResult> {
  const issueUrl = deps.params?.issue_url;
  const issueNumber = deps.params?.issue_number;
  // The number is the filed sentinel, not the url: a filed Issue always has a
  // number, while the url is optional — keying on the url would audit a real
  // Issue as audit_only.
  const filed = Boolean(issueNumber);

  await deps.writeAudit({
    event_type: "escalation_issued",
    task_id: input.taskId,
    repo: input.repo,
    payload: {
      branch_name: input.branchName,
      reason: input.reason,
      outcome: filed ? "issue_created" : "audit_only",
      ...(filed ? { issue_number: issueNumber } : {}),
      ...(filed && issueUrl ? { issue_url: issueUrl } : {}),
    },
  });

  await deps.notify(
    filed
      ? `🚨 Lore needs human help (${input.reason}) — ${issueUrl ?? `issue #${issueNumber}`}`
      : // No Issue to read, so the message IS the escalation: the same rendered
        // body the Issue would have carried, not a bare diagnostic string.
        `🚨 Lore needs human help (${input.reason}) on ${input.branchName} — Issue creation failed.\n\n${renderEscalationBody(input)}`,
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
