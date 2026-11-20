// The one-story review: the story the tests tell, the gaps the implementation and the issue leave against it, and the review GitHub is given.
import type { ReviewFinding, ReviewOutput } from "../review-findings.js";
import {
  answerOf,
  checked,
  told,
  type Check,
  type Declined,
  type Gap,
  type Place,
  type StoryPart,
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
  /** The story's paragraphs; absent until tell-story has answered. */
  parts: StoryPart[] | undefined;
  /** The story in a few plain sentences, the version the comment shows. */
  short: string | undefined;
  checks: Array<Check | undefined>;
  gaps: Gap[];
  /** Earlier gaps a person answered that they will not fix; they are shown and do not request changes. */
  declined: Declined[];
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
  return [
    "## Lore code review",
    `Reviewed revision \`${revision}\` · **${verdictOf(review, state, incomplete)}** · ${counted(review.gaps.length, "gap")}`,
    ...storyLines(review),
    ...gapTable(review.gaps),
    ...declinedList(review.declined),
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

// Prose, a paragraph a theme: a list only where the story itself enumerates, and the tests that prove a paragraph under it.
function storyLines({ parts, short }: Review): string[] {
  if (!parts) {
    return [];
  }
  const told = parts.flatMap(({ text, list, tests }) => [
    escapeMarkdown(text),
    ...(list.length
      ? [list.map((entry) => `- ${escapeMarkdown(entry)}`).join("\n")]
      : []),
    ...(tests.length ? [`Tests: ${testsOf(tests)}`] : []),
  ]);

  return ["### The story the tests tell", ...shortened(short, told)];
}

/** The short story on top and the full one folded under it; a story told without a short version is shown in full. */
function shortened(short: string | undefined, told: string[]): string[] {
  if (told.length === 0) {
    return ["The tests tell nothing about this change."];
  }

  return short
    ? [
        escapeMarkdown(short),
        "<details><summary>The full story, with its tests</summary>",
        ...told,
        "</details>",
      ]
    : told;
}

/** Each test file once, with the lines its tests start on. */
function testsOf(tests: Place[]): string {
  const paths = [...new Set(tests.map(({ path }) => path))];

  return paths
    .map((path) => {
      const starts = tests
        .filter((test) => test.path === path)
        .map(({ line }) => line);

      return `\`${path}\` (${starts.join(", ")})`;
    })
    .join(", ");
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

function declinedList(declined: Declined[]): string[] {
  if (declined.length === 0) {
    return [];
  }
  const entries = declined.map(
    ({ subject, reply }) => `- ${escapeMarkdown(subject)} ([reply](${reply}))`,
  );

  return [["Declined by a person, not blocking:", ...entries].join("\n")];
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
    parts: story?.story,
    short: story?.summary,
    checks,
    gaps: checks.flatMap((check) => check?.gaps ?? []),
    declined: checks.flatMap((check) => check?.declined ?? []),
    complete: [story, ...checks].map((answer) => answer?.status === "complete"),
  };
}

function summaryOf({ gaps, checks, declined }: Review): string {
  const story =
    gaps.length === 0
      ? "The implementation and the issue tell the story the tests tell."
      : `${counted(gaps.length, "gap")} ${gaps.length === 1 ? "separates" : "separate"} the story the tests tell from the implementation and the issue.`;
  const subjects = (label: string, named: string[]) =>
    named.length ? [`${label}: ${named.map(escapeMarkdown).join("; ")}.`] : [];

  return [
    story,
    ...subjects(
      "Closed since the last review",
      checks.flatMap((check) => check?.closed ?? []),
    ),
    ...subjects(
      "Declined by a person and not blocking",
      declined.map(({ subject }) => subject),
    ),
  ].join(" ");
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
    .replace(/[\\*_[\]~]/g, "\\$&")
    .replace(/\r?\n/g, " ");
}
