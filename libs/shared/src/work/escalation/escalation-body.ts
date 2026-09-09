/** Pure escalation-body rendering (moved from apps/floor/src/work/platform/escalation.ts); the file/notify SEQUENCE now lives in escalation.yaml as recorded-visit edges, not a catch block. */

/** Why escalation fired; reaches the Issue title, so it must be the actual cause (e.g. don't label a clean no-op run "supervisor_panic"). */
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
  /** Phase output that triggered the escalation (e.g. lint stderr, failing test output); inlined into the Issue body verbatim. */
  failingPhaseOutput?: string;
}

/** Renders the Issue body a human reads (branch, commit log, diagnostic, failing output, contributing refs) per FR3.8; pure — which surfaces it reaches is the escalation line's business. */
export function renderEscalationBody(input: EscalateInput): string {
  return [
    ...header(input),
    ...failingOutput(input.failingPhaseOutput),
    ...contributingContext(input.contributingRefs),
    ``,
    `---`,
    `*Issued by [Lore](https://github.com/re-cinq/lore). Inspect the branch to see partial work.*`,
  ].join("\n");
}

/** Identity and diagnosis. The branch and its commit log are LINKED rather than described: the first thing a human does with an escalation is look at what the agent actually left behind. */
function header(input: EscalateInput): string[] {
  return [
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
}

function failingOutput(output: string | undefined): string[] {
  return output
    ? [``, `### Failing phase output`, ``, "```", output, "```"]
    : [];
}

/** The context that fed the run. Listed so a human can tell a bad answer from a bad question — an escalation caused by a stale convention is fixed in the knowledge base, not in the code. */
function contributingContext(
  refs: EscalateInput["contributingRefs"],
): string[] {
  if (!refs || refs.length === 0) {
    return [];
  }

  return [
    ``,
    `### Contributing context`,
    ``,
    ...refs.map(
      (ref) => `- ${ref.type} \`${ref.id}\`${ref.text ? `: ${ref.text}` : ""}`,
    ),
  ];
}
