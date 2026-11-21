// The comment a pull request carries while and after it is reviewed: the story, the gaps, and what the checks read.
import type { Declined, Gap, Place } from "./story-answers.js";
import {
  asksForChanges,
  kinds,
  type PassName,
  type Review,
  type ReviewState,
} from "./story-model.js";
import { counted, escapeMarkdown, LINKS_ONLY } from "./story-text.js";

interface Publication {
  revision: string;
  state: ReviewState;
  required: readonly PassName[];
}

export function commentOf(
  review: Review,
  incomplete: string[],
  { revision, state, required }: Publication,
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
function placeOf({ path, line }: Place): string {
  return `\`${path}:${line}\``;
}

function cell(value: string): string {
  return escapeMarkdown(value).replaceAll("|", "\\|");
}
