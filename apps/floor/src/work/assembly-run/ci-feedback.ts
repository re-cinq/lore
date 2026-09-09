/** What CI said about the push this node is being launched to repair. */
export interface CiFeedback {
  sha: string;
  failedChecks: string;
  summary: string;
}

/** How much of a CI report the prompt carries, matching the cap on every other appended failure. */
const MAX_FEEDBACK_CHARS = 2500;

/** One string arg off the run, or "" when it is absent or not a string. */
function argText(args: Record<string, unknown>, key: string): string {
  const value = args[key];

  return typeof value === "string" ? value : "";
}

/** The CI verdict this launch should answer for, or null when the run did not arrive here from a red build. Gated on the INCOMING visit rather than on the args alone: the args persist on the run after they are acted on, and a later node must not be handed a verdict that has already been repaired. */
export function ciFeedbackOf(
  visits: ReadonlyArray<{ nodeId: string; outcome: string | null }>,
  args: Record<string, unknown>,
): CiFeedback | null {
  const incoming = visits.filter((v) => v.outcome !== null).at(-1);
  const failedChecks = argText(args, "ci_failed_checks");

  if (incoming?.outcome !== "changes_requested" || !failedChecks) {
    return null;
  }

  return {
    sha: argText(args, "ci_feedback_sha"),
    failedChecks,
    summary: argText(args, "ci_failure_summary"),
  };
}

/** Append what CI reported to the prompt the next node runs on. Kept out of the prompt TEMPLATE so every recipe shares it, exactly as the failure blocks beside it are. */
export function withCiFeedback(
  prompt: string,
  feedback: CiFeedback | null,
): string {
  if (!feedback) {
    return prompt;
  }

  return `${prompt}

## CI reported failures on ${feedback.sha}

The build for your last push is red. These checks failed: ${feedback.failedChecks}

Map each name to the job that publishes it and run only that job's command.
${reportedDetail(feedback.summary)}`;
}

/** What the jobs said, fenced — or nothing at all. An Actions job usually reports no output, and an empty fence reads as "CI said nothing about this" when the truth is that it said nothing HERE. */
function reportedDetail(summary: string): string {
  if (summary === "") {
    return "";
  }

  const capped =
    summary.length > MAX_FEEDBACK_CHARS
      ? `${summary.substring(0, MAX_FEEDBACK_CHARS)}\n...(truncated)`
      : summary;

  return `
\`\`\`
${capped}
\`\`\`
`;
}
