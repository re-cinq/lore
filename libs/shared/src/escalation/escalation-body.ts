/**
 * What a human is told when a task needs them, and the shape it is told in.
 *
 * The PURE half of what used to be `apps/floor/src/jobs/platform/escalation.ts`:
 * the input a diagnostic is rendered from, and the rendering itself. The
 * SEQUENCE that used to wrap it — file the Issue, fall back to audit-only,
 * notify — is now `escalation.yaml`, where each step is a recorded visit and
 * the fallback is an edge rather than a catch block.
 *
 * It lives in shared because both ends need it: the escalation station renders
 * the body, and whatever decides to escalate builds the input.
 */

export interface IssueCreator {
  create(
    title: string,
    body: string,
    labels?: string[],
  ): Promise<{ number: number; url?: string }>;
}

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
  /** Issue-creation surface — defaults to the Project facade for `repo`. */
  issues?: IssueCreator;
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

// Two retries after the initial call (3 attempts total, ~5s tail). The supervisor
// lease is held while we wait, and the audit_only fallback already preserves the
// diagnostic in Slack — a longer tail doesn't buy reliability proportional to the
// lease-hold cost.

/**
 * Escalate a stuck task to humans. Per FR3.8 + research R3:
 *  1. Compose a structured Issue body with branch link, diagnostic,
 *     failing phase output, and contributing refs.
 *  2. Try to open a GitHub Issue (3 attempts, backoff 1s/4s).
 *  3. On success: write `escalation_issued` audit entry naming the
 *     issue; fire a Slack-equivalent notification.
 *  4. On final failure: write the audit entry with `outcome:
 *     audit_only` and inline the full body into the Slack
 *     notification (so a human still sees the diagnostic somewhere).
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
    lines.push(
      ``,
      `### Failing phase output`,
      ``,
      "```",
      input.failingPhaseOutput,
      "```",
    );
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
