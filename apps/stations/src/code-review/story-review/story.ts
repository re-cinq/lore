// The one-story review: the story the tests tell, the gaps the implementation and the issue leave against it, and the review GitHub is given.
import type {
  ReviewFinding,
  ReviewOutput,
} from "@re-cinq/lore-shared/review/review-findings.js";
import {
  answerOf,
  checked,
  told,
  type Check,
  type Gap,
  type Place,
  type StoryLine,
} from "./story-answers.js";

export const reviewPasses = [
  "story",
  "implementation_check",
  "issue_check",
] as const;
type PassName = (typeof reviewPasses)[number];
export type PassOutputs = Partial<Record<PassName, string>>;
export type ReviewState = "running" | "complete" | "failed";

const passes: Record<PassName, string> = {
  story: "Story",
  implementation_check: "Implementation check",
  issue_check: "Issue check",
};
const kinds: Record<Gap["kind"], string> = {
  contradiction: "Contradiction",
  missing_test: "Missing test",
  missing_implementation: "Missing implementation",
  untold: "Untold",
};

interface Review {
  /** The story's lines; absent until tell-story has answered. */
  lines: StoryLine[] | undefined;
  checks: Array<Check | undefined>;
  gaps: Gap[];
  /** The passes, in order, that gave a complete answer. */
  complete: boolean[];
}

/** The comment the pull request carries while and after it is reviewed, and the passes among the first `passCount` that gave no complete answer. */
export function storyReview(
  outputs: PassOutputs,
  passCount: number,
): {
  incomplete: string[];
  comment(revision: string, state: ReviewState): string;
} {
  const review = reviewOf(outputs);
  const incomplete = reviewPasses
    .slice(0, passCount)
    .filter((_name, index) => !review.complete[index])
    .map((name) => passes[name]);

  return {
    incomplete,
    comment: (revision, state) =>
      commentOf(review, incomplete, { revision, state }),
  };
}

function commentOf(
  review: Review,
  incomplete: string[],
  { revision, state }: { revision: string; state: ReviewState },
): string {
  const counts = `${counted((review.lines ?? []).length, "story line")}, ${counted(review.gaps.length, "gap")}`;

  return [
    "## Lore code review",
    `Reviewed revision \`${revision}\` · **${verdictOf(review, state, incomplete)}** · ${counts}`,
    ...storyLines(review),
    ...gapTable(review.gaps),
    ...review.checks.flatMap((check) =>
      check ? [escapeMarkdown(check.summary)] : [],
    ),
    ...(incomplete.length ? [`Incomplete — ${incomplete.join(", ")}`] : []),
    ...(state === "failed"
      ? ["Lore reviews this revision from its whole diff instead."]
      : []),
  ].join("\n\n");
}

function verdictOf(
  review: Review,
  state: ReviewState,
  incomplete: string[],
): string {
  if (state === "failed" || incomplete.length > 0) {
    return "Incomplete";
  }

  if (state === "running") {
    return "In progress";
  }

  return review.gaps.some(asksForChanges) ? "Changes requested" : "Approved";
}

function storyLines({ lines }: Review): string[] {
  if (!lines) {
    return [];
  }
  const numbered = lines.map(
    ({ behaviour, tests }, index) =>
      `${index + 1}. ${escapeMarkdown(behaviour)}\n   ${tests.map(placeOf).join(", ")}`,
  );

  return [
    "### The story the tests tell",
    numbered.join("\n") || "The tests tell nothing about this change.",
  ];
}

function gapTable(gaps: Gap[]): string[] {
  if (gaps.length === 0) {
    return [];
  }
  const rows = gaps.map(
    ({ kind, subject, location }, index) =>
      `| ${index + 1} | ${kinds[kind]} | ${cell(subject)} | ${location ? placeOf(location) : "pull request"} |`,
  );

  return [
    "### Gaps",
    [
      "| # | Kind | What differs | Where |",
      "|---|------|--------------|-------|",
      ...rows,
    ].join("\n"),
  ];
}

/** The review GitHub is given once all three passes are complete: one finding per gap on its line, the rest in the body, and changes requested for any gap but an untold one. */
export function formalReview(outputs: PassOutputs): ReviewOutput | undefined {
  const review = reviewOf(outputs);

  if (!review.complete.every(Boolean)) {
    return;
  }
  const unplaced = review.gaps.filter(({ location }) => !location);

  return {
    verdict: review.gaps.some(asksForChanges)
      ? "changes_requested"
      : "approved",
    summary: summaryOf(review),
    findings: review.gaps.flatMap((found) =>
      found.location ? [{ ...found.location, ...findingOf(found) }] : [],
    ),
    ...(unplaced.length ? { generalFindings: unplaced.map(findingOf) } : {}),
  };
}

function reviewOf(outputs: PassOutputs): Review {
  const story = answerOf(told, outputs.story);
  const checks = [
    answerOf(checked, outputs.implementation_check),
    answerOf(checked, outputs.issue_check),
  ];

  return {
    lines: story?.story,
    checks,
    gaps: checks.flatMap((check) => check?.gaps ?? []),
    complete: [story, ...checks].map((answer) => answer?.status === "complete"),
  };
}

function summaryOf({ lines, gaps, checks }: Review): string {
  const behaviours = counted((lines ?? []).length, "behaviour");
  const closed = checks.flatMap((check) => check?.closed ?? []);
  const story =
    gaps.length === 0
      ? `The tests tell ${behaviours}, and the implementation and the issue tell the same story.`
      : `The tests tell ${behaviours}; ${counted(gaps.length, "gap")} ${gaps.length === 1 ? "separates" : "separate"} that story from the implementation and the issue.`;

  return closed.length
    ? `${story} Closed since the last review: ${closed.map(escapeMarkdown).join("; ")}.`
    : story;
}

function findingOf(found: Gap): Omit<ReviewFinding, "path" | "line"> {
  const blocking = asksForChanges(found);
  const { suggestion, block } = proposalOf(found);

  return {
    label: blocking ? "issue" : "question",
    decoration: blocking ? "blocking" : "non-blocking",
    subject: `${kinds[found.kind]}: ${escapeMarkdown(found.subject)}`,
    discussion: [
      escapeMarkdown(found.detail),
      ...block,
      ...found.evidence.map(escapeMarkdown),
    ].join("\n\n"),
    ...suggestion,
  };
}

/** A proposal that replaces exactly its line is a GitHub suggestion; any other is a code block in the comment. */
function proposalOf({ proposal, replaces_line: replaces }: Gap): {
  suggestion: { suggestion?: string };
  block: string[];
} {
  if (!proposal) {
    return { suggestion: {}, block: [] };
  }

  return replaces
    ? { suggestion: { suggestion: proposal }, block: [] }
    : { suggestion: {}, block: [`Proposed:\n\n\`\`\`\n${proposal}\n\`\`\``] };
}

function asksForChanges({ kind }: Gap): boolean {
  return kind !== "untold";
}

function counted(count: number, noun: string): string {
  return `${count} ${noun}${count === 1 ? "" : "s"}`;
}

function placeOf({ path, line }: Place): string {
  return `\`${path}:${line}\``;
}

function cell(value: string): string {
  return escapeMarkdown(value).replaceAll("|", "\\|");
}

function escapeMarkdown(value: string): string {
  return value
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll("@", "&#64;")
    .replace(/[\\`*_[\]~]/g, "\\$&")
    .replace(/\r?\n/g, " ");
}
