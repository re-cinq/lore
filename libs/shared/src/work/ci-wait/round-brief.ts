// What the next agent of a line is told about a red build or about the changes Lore's review asked for: CI's verdict or the review's findings, and the previous round's own account of what it did and what it left. Written as one file the wait hands on, because a prompt cannot hold a placeholder for something the first round does not have.

/** What CI said about the push the next agent is launched to repair. */
export interface CiFeedback {
  sha: string;
  failedChecks: string;
  summary: string;
}

/** What Lore's review asked to change on the commit it judged. */
export interface ReviewFeedback {
  sha: string;
  findings: string;
}

/** A round's own account of itself. */
export interface RoundHandoff {
  done: string | null;
  next: string;
}

export interface RoundBriefInput {
  /** Null when the build is not what the next agent is sent for. */
  feedback: CiFeedback | null;
  /** Null when Lore's review is not what the next agent is sent for. */
  review: ReviewFeedback | null;
  /** Null when no round has run yet, or the last one reported nothing. */
  handoff: RoundHandoff | null;
}

/** How much of a CI report the brief carries. */
const MAX_FEEDBACK_CHARS = 2500;

export function roundBriefOf({
  feedback,
  review,
  handoff,
}: RoundBriefInput): string {
  const sections = [
    ...(feedback ? [ciFeedbackSection(feedback)] : []),
    ...(review ? [reviewSection(review)] : []),
    ...(handoff ? [handoffSection(handoff)] : []),
  ];

  return sections.join("\n");
}

/** The section a red build is told to the next agent as, whether it rides in a round brief or at the end of a prompt. */
export function ciFeedbackSection(feedback: CiFeedback): string {
  return `## CI reported failures on ${feedback.sha}

The build for your last push is red. These checks failed: ${feedback.failedChecks}

Where a failed step is named below, run only that step's command; otherwise map each name to the job that publishes it and run only that job's command.
${reportedDetail(feedback.summary)}`;
}

/** What the jobs said, fenced, or nothing at all: an empty fence reads as "CI said nothing about this" when the truth is that it said nothing HERE. */
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

function reviewSection(review: ReviewFeedback): string {
  return `## Lore's review asked for changes on ${review.sha}

Make the changes these findings ask for, and only those. A finding you judge wrong is left as it is, with the reason in your report.

${review.findings}
`;
}

function handoffSection(handoff: RoundHandoff): string {
  const doneLine = handoff.done ? `- Done: ${handoff.done}\n` : "";

  return `## The previous round reported

${doneLine}- Next: ${handoff.next}
`;
}
