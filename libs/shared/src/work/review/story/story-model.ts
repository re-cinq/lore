// What the one-story review holds once its agents have answered: the story, the checks, their gaps, and which passes are complete.
import {
  answerOf,
  checked,
  told,
  type Check,
  type Declined,
  type Gap,
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

export const kinds: Record<Gap["kind"], string> = {
  contradiction: "Contradiction",
  missing_test: "Missing test",
  missing_implementation: "Missing implementation",
  untold: "Untold",
  unlinked: "No test link",
};

export interface Review {
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

export function reviewOf(outputs: PassOutputs): Review {
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

export function asksForChanges({ kind }: Gap): boolean {
  return kind !== "untold" && kind !== "unlinked";
}
