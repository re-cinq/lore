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

/**
 * Why a human is being asked for. It reaches them in the Issue title, so it has
 * to be the actual cause — "supervisor_panic" on a run that simply produced no
 * commits sends someone looking for a crash that did not happen.
 */
export type EscalationReason =
  | "validation_failed_twice"
  | "bot_review_failed_parse"
  | "supervisor_panic"
  | "iteration_max_exceeded"
  /** The agent finished cleanly and changed nothing. */
  | "no_code_changes"
  /** A PR for this branch was already open, so the run had nowhere to land. */
  | "pr_already_exists";

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
}

/**
 * The Issue body a human reads: branch link, commit log, diagnostic, the failing
 * phase output when there is one, and the facts and memories that fed the
 * attempt. Per FR3.8.
 *
 * Pure. Which surfaces this reaches — the Issue, the audit log, the notification
 * channels — is the escalation LINE's business, and the ports that were once
 * fields on this input are now that station's deps.
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
