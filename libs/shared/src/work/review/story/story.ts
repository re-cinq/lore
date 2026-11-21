// The one-story review: the story the tests tell, the gaps the implementation and the issue leave against it, and the review GitHub is given.
import type { ReviewFinding, ReviewOutput } from "../review-findings.js";
import type { Gap } from "./story-answers.js";
import { commentOf } from "./story-comment.js";
import {
  asksForChanges,
  kinds,
  reviewOf,
  storyPasses,
  type PassName,
  type PassOutputs,
  type Review,
  type ReviewState,
} from "./story-model.js";
import { counted, escapeMarkdown, LINKS_ONLY } from "./story-text.js";

export {
  reviewPasses,
  storyPasses,
  type PassName,
  type PassOutputs,
  type ReviewState,
} from "./story-model.js";

const passes: Record<PassName, string> = {
  story: "Story",
  implementation_check: "Implementation check",
  issue_check: "Issue check",
  docs_check: "Documents check",
};

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
