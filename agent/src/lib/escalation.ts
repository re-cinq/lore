import type { Octokit } from "octokit";
import { writeAuditLog } from "./audit.js";

export type EscalationReason =
  | "validation_failed_twice"
  | "bot_review_failed_parse"
  | "supervisor_panic"
  | "iteration_max_exceeded";

export interface ContributingRef {
  type: "fact" | "memory";
  id: string;
  text?: string;
}

export interface EscalateInput {
  taskId: string;
  repo: string;
  branchName: string;
  reason: EscalationReason;
  /** Human-readable explanation of why escalation fired. */
  diagnostic: string;
  /** Optional facts/memories that contributed to the failed attempt. */
  contributingRefs?: ContributingRef[];
  /**
   * Phase output that triggered the escalation (e.g. lint stderr,
   * failing test output). Inlined into the Issue body verbatim.
   */
  failingPhaseOutput?: string;
  octokit: Octokit;
  /**
   * Slack-style notifier. Wired by the caller to whatever notification
   * surface is configured. Called with `level=escalation`. Receives the
   * full body when Issue creation degraded to audit_only.
   */
  notify?: (msg: string, level: "escalation") => Promise<void> | void;
}

export type EscalateOutcome = "issue_created" | "audit_only";

export interface EscalateResult {
  outcome: EscalateOutcome;
  issueNumber?: number;
  issueUrl?: string;
}

const RETRY_DELAYS_MS = [1000, 4000, 16000];

/**
 * Escalate a stuck task to humans. Per FR3.8 + research R3:
 *  1. Compose a structured Issue body with branch link, diagnostic,
 *     failing phase output, and contributing refs.
 *  2. Try to open a GitHub Issue (3 attempts, exponential backoff
 *     1s/4s/16s).
 *  3. On success: write `escalation_issued` audit entry naming the
 *     issue; fire a Slack-equivalent notification.
 *  4. On final failure: write the audit entry with `outcome:
 *     audit_only` and inline the full body into the Slack
 *     notification (so a human still sees the diagnostic somewhere).
 */
export async function escalate(input: EscalateInput): Promise<EscalateResult> {
  const body = renderEscalationBody(input);
  const title = `[lore] needs-human-help: ${input.reason} on ${input.branchName}`;

  const issue = await createIssueWithBackoff({
    octokit: input.octokit,
    repo: input.repo,
    title,
    body,
  });

  if (issue.success) {
    await writeAuditLogSafe({
      event_type: "escalation_issued",
      task_id: input.taskId,
      repo: input.repo,
      payload: {
        branch_name: input.branchName,
        reason: input.reason,
        outcome: "issue_created" as EscalateOutcome,
        issue_number: issue.issueNumber,
        issue_url: issue.issueUrl,
        issued_at: new Date().toISOString(),
      },
    });
    if (input.notify) {
      await Promise.resolve(
        input.notify(
          `🚨 Lore needs human help (${input.reason}) — ${issue.issueUrl}`,
          "escalation",
        ),
      );
    }
    return {
      outcome: "issue_created",
      issueNumber: issue.issueNumber,
      issueUrl: issue.issueUrl,
    };
  }

  // Degrade to audit-only path. Slack must carry the diagnostic since
  // the Issue surface failed.
  await writeAuditLogSafe({
    event_type: "escalation_issued",
    task_id: input.taskId,
    repo: input.repo,
    payload: {
      branch_name: input.branchName,
      reason: input.reason,
      outcome: "audit_only" as EscalateOutcome,
      issue_creation_error: issue.error.message,
      issued_at: new Date().toISOString(),
    },
  });
  if (input.notify) {
    await Promise.resolve(
      input.notify(
        `🚨 Lore needs human help (${input.reason}) — Issue creation failed.\n\n${body}`,
        "escalation",
      ),
    );
  }
  return { outcome: "audit_only" };
}

/**
 * Pure body renderer (exported for testing / for callers that want to
 * preview the message before firing). Includes a clickable link to
 * `git log <branch>` so the human can inspect partial work directly
 * without re-deriving where the supervisor stopped.
 */
export function renderEscalationBody(input: EscalateInput): string {
  const lines: string[] = [
    `## Lore Pipeline Escalation`,
    ``,
    `**Task ID:** \`${input.taskId}\``,
    `**Branch:** [\`${input.branchName}\`](https://github.com/${input.repo}/tree/${encodeURIComponent(input.branchName)})`,
    `**Commit log:** [\`git log ${input.branchName}\`](https://github.com/${input.repo}/commits/${encodeURIComponent(input.branchName)})`,
    `**Reason:** \`${input.reason}\``,
    ``,
    `### Diagnostic`,
    ``,
    input.diagnostic,
  ];

  if (input.failingPhaseOutput) {
    lines.push(``, `### Failing phase output`, ``, "```", input.failingPhaseOutput, "```");
  }

  if (input.contributingRefs && input.contributingRefs.length > 0) {
    lines.push(``, `### Contributing context`, ``);
    for (const ref of input.contributingRefs) {
      lines.push(
        `- ${ref.type} \`${ref.id}\`${ref.text ? `: ${ref.text}` : ""}`,
      );
    }
  }

  lines.push(
    ``,
    `---`,
    `*Issued by [Lore](https://github.com/re-cinq/lore). Inspect the branch to see partial work.*`,
  );

  return lines.join("\n");
}

interface CreateIssueResult {
  success: true;
  issueNumber: number;
  issueUrl: string;
}
interface CreateIssueFailure {
  success: false;
  error: Error;
}

async function createIssueWithBackoff(opts: {
  octokit: Octokit;
  repo: string;
  title: string;
  body: string;
}): Promise<CreateIssueResult | CreateIssueFailure> {
  const [owner, name] = opts.repo.split("/");
  let lastError: Error | undefined;

  for (let attempt = 0; attempt < RETRY_DELAYS_MS.length; attempt++) {
    try {
      const response = await opts.octokit.rest.issues.create({
        owner,
        repo: name,
        title: opts.title,
        body: opts.body,
        labels: ["needs-human-help", "lore-managed"],
      });
      return {
        success: true,
        issueNumber: response.data.number,
        issueUrl: response.data.html_url,
      };
    } catch (err) {
      lastError = err as Error;
      if (attempt < RETRY_DELAYS_MS.length - 1) {
        await new Promise((resolve) =>
          setTimeout(resolve, RETRY_DELAYS_MS[attempt]),
        );
      }
    }
  }

  return { success: false, error: lastError ?? new Error("unknown") };
}

async function writeAuditLogSafe(
  entry: Parameters<typeof writeAuditLog>[0],
): Promise<void> {
  try {
    await writeAuditLog(entry);
  } catch (err) {
    console.warn(
      "[escalate] audit log write failed:",
      (err as Error).message,
    );
  }
}
