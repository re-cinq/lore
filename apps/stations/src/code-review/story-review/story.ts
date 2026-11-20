// The one-story review: the story the tests tell, the gaps the implementation and the issue leave against it, and the review GitHub is given.
import { resultTextFromOutput } from "@re-cinq/lore-assembly-lines";
import type {
  ReviewFinding,
  ReviewOutput,
} from "@re-cinq/lore-shared/review/review-findings.js";
import { z } from "zod";
import { jsonCandidates } from "./json-candidates.js";

const status = z.enum(["complete", "incomplete"]);
const text = z.string().trim().min(1);
const place = z.object({ path: text, line: z.number().int().positive() });
const told = z.object({
  status,
  story: z.array(
    z.object({ id: z.number().int(), behaviour: text, tests: z.array(place) }),
  ),
});
const gap = z.object({
  kind: z.enum([
    "contradiction",
    "missing_test",
    "missing_implementation",
    "untold",
  ]),
  subject: text,
  detail: text,
  location: place
    .extend({ side: z.enum(["LEFT", "RIGHT"]).optional() })
    .optional(),
  proposal: text.optional(),
  replaces_line: z.boolean().optional(),
  evidence: z.array(text).default([]),
});
const checked = z.object({
  status,
  summary: text,
  gaps: z.array(gap),
  closed: z.array(text).default([]),
});

type Gap = z.infer<typeof gap>;

const passes = {
  story: "Story",
  implementation_check: "Implementation check",
  issue_check: "Issue check",
} as const;

export const reviewPasses = [
  "story",
  "implementation_check",
  "issue_check",
] as const;
type PassName = (typeof reviewPasses)[number];
export type PassOutputs = Partial<Record<PassName, string>>;
export type ReviewState = "running" | "complete" | "failed";

const kinds = {
  contradiction: "Contradiction",
  missing_test: "Missing test",
  missing_implementation: "Missing implementation",
  untold: "Untold",
} as const;

interface Review {
  story: z.infer<typeof told> | undefined;
  checks: Array<z.infer<typeof checked> | undefined>;
  gaps: Gap[];
}

function reviewOf(outputs: PassOutputs): Review {
  const checks = [
    parse(checked, outputs.implementation_check),
    parse(checked, outputs.issue_check),
  ];

  return {
    story: parse(told, outputs.story),
    checks,
    gaps: checks.flatMap((check) => check?.gaps ?? []),
  };
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
  const complete = [review.story, ...review.checks].map(
    (answer) => answer?.status === "complete",
  );
  const incomplete = reviewPasses
    .slice(0, passCount)
    .filter((_name, index) => !complete[index])
    .map((name) => passes[name]);

  return {
    incomplete,
    comment: (revision, state) =>
      [
        "## Lore code review",
        `Reviewed revision \`${revision}\` · **${verdictOf(review, state, incomplete)}** · ${counted(review.story?.story.length ?? 0, "story line")}, ${counted(review.gaps.length, "gap")}`,
        ...storyLines(review),
        ...gapTable(review.gaps),
        ...review.checks.flatMap((check) =>
          check ? [escapeMarkdown(check.summary)] : [],
        ),
        ...(incomplete.length ? [`Incomplete — ${incomplete.join(", ")}`] : []),
        ...(state === "failed"
          ? ["Lore reviews this revision from its whole diff instead."]
          : []),
      ].join("\n\n"),
  };
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

function storyLines({ story }: Review): string[] {
  if (!story) {
    return [];
  }
  const lines = story.story.map(
    ({ behaviour, tests }, index) =>
      `${index + 1}. ${escapeMarkdown(behaviour)}\n   ${tests.map(placeOf).join(", ")}`,
  );

  return [
    "### The story the tests tell",
    lines.join("\n") || "The tests tell nothing about this change.",
  ];
}

function gapTable(gaps: Gap[]): string[] {
  if (gaps.length === 0) {
    return [];
  }
  const rows = gaps.map(
    ({ kind, subject, detail, location }, index) =>
      `| ${index + 1} | ${kinds[kind]} | ${cell(subject)} — ${cell(detail)} | ${location ? placeOf(location) : "pull request"} |`,
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

  if (storyReview(outputs, reviewPasses.length).incomplete.length > 0) {
    return;
  }
  const placed = review.gaps.filter(({ location }) => location);
  const unplaced = review.gaps.filter(({ location }) => !location);

  return {
    verdict: review.gaps.some(asksForChanges)
      ? "changes_requested"
      : "approved",
    summary: summaryOf(review),
    findings: placed.map((found) => ({
      ...(found.location as NonNullable<Gap["location"]>),
      ...findingOf(found),
    })),
    ...(unplaced.length ? { generalFindings: unplaced.map(findingOf) } : {}),
  };
}

function summaryOf({ story, gaps, checks }: Review): string {
  const behaviours = counted(story?.story.length ?? 0, "behaviour");
  const closed = checks.flatMap((check) => check?.closed ?? []);
  const told =
    gaps.length === 0
      ? `The tests tell ${behaviours}, and the implementation and the issue tell the same story.`
      : `The tests tell ${behaviours}; ${counted(gaps.length, "gap")} ${gaps.length === 1 ? "separates" : "separate"} that story from the implementation and the issue.`;

  return closed.length
    ? `${told} Closed since the last review: ${closed.map(escapeMarkdown).join("; ")}.`
    : told;
}

function findingOf(found: Gap): Omit<ReviewFinding, "path" | "line"> {
  const blocking = asksForChanges(found);
  const proposed =
    found.proposal && !found.replaces_line
      ? [`Proposed:\n\n\`\`\`\n${found.proposal}\n\`\`\``]
      : [];

  return {
    label: blocking ? "issue" : "question",
    decoration: blocking ? "blocking" : "non-blocking",
    subject: `${kinds[found.kind]}: ${escapeMarkdown(found.subject)}`,
    discussion: [
      escapeMarkdown(found.detail),
      ...proposed,
      ...found.evidence.map(escapeMarkdown),
    ].join("\n\n"),
    ...(found.proposal && found.replaces_line
      ? { suggestion: found.proposal }
      : {}),
  };
}

function asksForChanges({ kind }: Gap): boolean {
  return kind !== "untold";
}

function counted(count: number, noun: string): string {
  return `${count} ${noun}${count === 1 ? "" : "s"}`;
}

function placeOf({ path, line }: z.infer<typeof place>): string {
  return `\`${path}:${line}\``;
}

function cell(value: string): string {
  return escapeMarkdown(value).replaceAll("|", "\\|");
}

function parse<T>(
  schema: z.ZodType<T>,
  output: string | undefined,
): T | undefined {
  if (!output) {
    return;
  }
  const answer = resultTextFromOutput(output)
    .replace(/(?:^|\n)LORE_NODE_RESULT: [^\r\n]+\s*$/, "")
    .trim();

  return jsonCandidates(answer)
    .map((candidate) => schema.safeParse(candidate).data)
    .find((result) => result !== undefined);
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
