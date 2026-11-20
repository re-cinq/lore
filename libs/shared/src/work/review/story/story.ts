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
  "docs_check",
] as const;
export type PassName = (typeof reviewPasses)[number];
/** The passes of a pull request that changes code or tests; its documents, when it changes any, are a fourth. */
export const storyPasses: readonly PassName[] = reviewPasses.slice(0, 3);
export type PassOutputs = Partial<Record<PassName, string>>;
export type ReviewState = "running" | "complete" | "failed";

const passes: Record<PassName, string> = {
  story: "Story",
  implementation_check: "Implementation check",
  issue_check: "Issue check",
  docs_check: "Documents check",
};
const kinds: Record<Gap["kind"], string> = {
  contradiction: "Contradiction",
  missing_test: "Missing test",
  missing_implementation: "Missing implementation",
  untold: "Untold",
  unlinked: "No test link",
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
  /** The subjects of earlier gaps a re-check found closed. */
  closed: string[];
  /** The passes that gave a complete answer. */
  complete: PassName[];
}

/** The comment the pull request carries while and after it is reviewed, and the passes among the `required` ones that gave no complete answer. */
export function storyReview(
  outputs: PassOutputs,
  required: readonly PassName[],
): {
  incomplete: string[];
  comment(revision: string, state: ReviewState): string;
} {
  const review = reviewOf(outputs);
  const incomplete = required
    .filter((name) => !review.complete.includes(name))
    .map((name) => passes[name]);

  return {
    incomplete,
    comment: (revision, state) =>
      commentOf(review, incomplete, { revision, state, required }),
  };
}

function commentOf(
  review: Review,
  incomplete: string[],
  {
    revision,
    state,
    required,
  }: { revision: string; state: ReviewState; required: readonly PassName[] },
): string {
  return [
    "## Lore code review",
    `Reviewed revision \`${revision}\` · **${verdictOf(review, state, incomplete)}** · ${counted(review.gaps.length, "gap")}`,
    ...(required.length ? [] : [LINKS_ONLY]),
    ...storyLines(review),
    ...gapTable(review.gaps),
    ...declinedList(review.declined),
    ...closedList(review.closed),
    ...checkNotes(review.checks),
    ...(incomplete.length ? [`Incomplete — ${incomplete.join(", ")}`] : []),
    ...(state === "failed"
      ? ["Lore reviews this revision from its whole diff instead."]
      : []),
  ].join("\n\n");
}

/** What each check says about how far it went, folded away: the story and the gaps are what the reader came for. */
function checkNotes(checks: Review["checks"]): string[] {
  const notes = checks.flatMap((check) =>
    check ? [escapeMarkdown(check.summary)] : [],
  );

  return notes.length
    ? [
        "<details><summary>What the checks read</summary>",
        ...notes,
        "</details>",
      ]
    : [];
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

// The comment names them and the review GitHub is given does not: a re-check is handed that review as the gaps left open.
function closedList(closed: string[]): string[] {
  return closed.length
    ? [
        [
          "Closed since the last review:",
          ...closed.map((subject) => `- ${escapeMarkdown(subject)}`),
        ].join("\n"),
      ]
    : [];
}

const LINKS_ONLY =
  "Only links changed in the Markdown of this pull request: nothing to review.";

/** The review GitHub is given once every `required` pass is complete: one finding per gap on its line, the rest in the body, and changes requested for any gap but an untold or an unlinked one. A review that requires no pass is the approval of a pull request that changes only links. */
export function formalReview(
  outputs: PassOutputs,
  required: readonly PassName[] = storyPasses,
): ReviewOutput | undefined {
  const review = reviewOf(outputs);

  if (!required.every((name) => review.complete.includes(name))) {
    return;
  }
  const unplaced = review.gaps.filter(({ location }) => !location);

  return {
    verdict: review.gaps.some(asksForChanges)
      ? "changes_requested"
      : "approved",
    summary: summaryOf(review, required),
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
    answerOf(checked, outputs.docs_check),
  ];

  return {
    parts: story?.story,
    short: story?.summary,
    checks,
    gaps: checks.flatMap((check) => check?.gaps ?? []),
    ...settledOf(checks),
    complete: reviewPasses.filter(
      (_name, index) => [story, ...checks][index]?.status === "complete",
    ),
  };
}

function settledOf(
  checks: Review["checks"],
): Pick<Review, "declined" | "closed"> {
  return {
    declined: once(
      checks.flatMap((check) => check?.declined ?? []),
      ({ reply }) => reply,
    ),
    closed: once(
      checks.flatMap((check) => check?.closed ?? []),
      wording,
    ),
  };
}

/** Both checks are handed the same earlier gaps and replies, so both name the same closed or declined one: the first of each is kept. */
function once<T>(entries: T[], keyOf: (entry: T) => string): T[] {
  const keys = entries.map(keyOf);

  return entries.filter((_entry, index) => keys.indexOf(keys[index]) === index);
}

function wording(subject: string): string {
  return subject.toLowerCase().replace(/\s+/g, " ").trim();
}

function summaryOf(
  { gaps, declined }: Review,
  required: readonly PassName[],
): string {
  const subjects = (label: string, named: string[]) =>
    named.length ? [`${label}: ${named.map(escapeMarkdown).join("; ")}.`] : [];

  return [
    verdictSentence(gaps.length, required),
    ...subjects(
      "Declined by a person and not blocking",
      declined.map(({ subject }) => subject),
    ),
  ].join(" ");
}

function verdictSentence(gaps: number, required: readonly PassName[]): string {
  if (required.length === 0) {
    return LINKS_ONLY;
  }
  const [told, against] = sidesOf(required);

  if (gaps > 0) {
    return `${counted(gaps, "gap")} ${gaps === 1 ? "separates" : "separate"} ${told} from ${against}.`;
  }

  return required.includes("story")
    ? `${against.replace("the", "The")} tell ${told}.`
    : "The changed documents say what their linked tests and the code say.";
}

/** What a review compares: the story with what was built and asked, or, with no story, the documents with their tests and the code. */
function sidesOf(required: readonly PassName[]): [string, string] {
  if (!required.includes("story")) {
    return ["the changed documents", "their linked tests and the code"];
  }

  return [
    "the story the tests tell",
    required.includes("docs_check")
      ? "the implementation, the issue and the changed documents"
      : "the implementation and the issue",
  ];
}

function findingOf(found: Gap): Omit<ReviewFinding, "path" | "line"> {
  const blocking = asksForChanges(found);
  const { suggestion, block } = proposalOf(found);
  const evidence = found.evidence.map(escapeMarkdown);

  return {
    label: blocking ? "issue" : "question",
    decoration: blocking ? "blocking" : "non-blocking",
    subject: `${kinds[found.kind]}: ${escapeMarkdown(found.subject)}`,
    discussion: [
      escapeMarkdown(found.detail),
      ...block,
      ...(evidence.length ? [`Evidence: ${evidence.join("; ")}`] : []),
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
  return kind !== "untold" && kind !== "unlinked";
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

// Inline code is shown as written: GitHub renders a backslash or an entity inside it literally.
function escapeMarkdown(value: string): string {
  return value
    .replace(/\r?\n/g, " ")
    .split(/(`[^`]+`)/)
    .map((part, index) => (index % 2 ? part : escapedProse(part)))
    .join("");
}

function escapedProse(prose: string): string {
  return prose
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll("@", "&#64;")
    .replace(/[\\*_[\]~]/g, "\\$&");
}
