// Pure decision/description helpers for the code-review choreography: no I/O, unit-tested directly.

import type {
  PullRef,
  ReviewComment,
} from "../../outbound/project/pulls/pull-requests-port.js";
import { SKIP_CI_MARKERS } from "../../outbound/project/pulls/check-runs.js";

/** A GitHub App / bot login ends with `[bot]`; only human actors drive the review. */
export function isBotActor(login: string): boolean {
  return login.endsWith("[bot]");
}

/** An explicit request to (re)review — the deterministic fast-path past the triage. */
export function isReviewRequest(body: string): boolean {
  return /(^|\s)[@/]?lore\s+review\b/i.test(body);
}

export function decideReviewOnOpen(input: {
  autoReview: boolean;
  pr: PullRef | null;
}): { start: boolean } {
  const { autoReview, pr } = input;

  return {
    start:
      autoReview &&
      !!pr &&
      pr.state === "open" &&
      pr.draft !== true &&
      !isBotActor(pr.author ?? ""),
  };
}

export function decideReviewOnReply(input: {
  autoReview: boolean;
  pr: PullRef | null;
  commentAuthor: string;
}): { start: boolean } {
  const { autoReview, pr, commentAuthor } = input;

  return {
    start:
      autoReview &&
      !!pr &&
      pr.state === "open" &&
      pr.draft !== true &&
      !isBotActor(commentAuthor),
  };
}

export function reviewDescription(
  repo: string,
  pr: number,
  branch: string,
): string {
  return `Review pull request #${pr} in ${repo} (branch ${branch}).`;
}

/** The re-check's brief. With the sha the last verdict judged it also names the range to read, which is the whole difference between a re-check and a second full review: a re-check that diffs `main...HEAD` re-reads the entire PR, and the ones on 2026-09-25 spent 59 commands doing it. */
export function recheckDescription(
  repo: string,
  pr: number,
  branch: string,
  sinceSha?: string,
): string {
  const scope = sinceSha
    ? ` The last verdict judged ${sinceSha}; read what changed since it with \`git -C /workspace/target diff ${sinceSha}..HEAD\`, and judge only that.`
    : "";

  return `Re-check pull request #${pr} in ${repo} (branch ${branch}) after a new push.${scope}`;
}

/** What a re-check decides from, all of it already in hand at the call site. */
export interface RecheckInput {
  /** The PR head now; absent when GitHub did not report one, where no in-flight run can be matched to it. */
  headSha?: string;
  /** Review-family runs still open on this PR, with the sha each was started for. */
  openReviewShas: readonly string[];
  /** The commit messages pushed since the last verdict, newest last; empty when the last judged sha is unknown. */
  newCommitMessages: readonly string[];
}

/** Whether a push earns its own re-check. Two pushes land within seconds of each other all day — a rebase, then the CI formatter's own commit — and each used to start a full Gemini pass: three verdicts inside four minutes on #2134, the last two judging what the first had already approved. Neither refusal here can lose a verdict: an in-flight run is judging this exact sha already, and a commit CI itself skips changes nothing a reviewer rules on. */
export function decideRecheck(input: RecheckInput): {
  start: boolean;
  reason: string;
} {
  if (
    input.headSha !== undefined &&
    input.openReviewShas.includes(input.headSha)
  ) {
    return { start: false, reason: "a review of this sha is already running" };
  }

  if (skipsCiOnly(input.newCommitMessages)) {
    return { start: false, reason: "the new commits all skip CI" };
  }

  return { start: true, reason: "new commits to judge" };
}

/** True when there ARE new commits and every one of them tells CI to skip it — the `style: prettier [skip ci]` the format job pushes onto the branch. No new commits is not this case: that is a re-trigger of the same head, which the sha guard above owns. */
function skipsCiOnly(messages: readonly string[]): boolean {
  return (
    messages.length > 0 &&
    messages.every((message) =>
      SKIP_CI_MARKERS.some((marker) => message.toLowerCase().includes(marker)),
    )
  );
}

/** Review feedback: body plus inline comments with ids for thread targeting. */
export function reviewFeedback(
  body: string,
  comments: ReviewComment[],
): string {
  const lines = comments.map((c) => {
    const where = c.line === null ? c.path : `${c.path}:${c.line}`;

    return `- inline comment ${c.id} on ${where}: ${c.body}`;
  });
  const trimmed = body.trim();

  if (lines.length === 0) {
    return trimmed;
  }
  const inline = `Inline comments:\n${lines.join("\n")}`;

  return trimmed ? `${trimmed}\n\n${inline}` : inline;
}

/** True once the PR is open and either forced or the auto-review gate says go. */
export function reviewGateOpen(
  pr: PullRef,
  input: { autoReview: boolean; forced?: boolean },
): boolean {
  if (pr.state !== "open") {
    return false;
  }

  return (
    input.forced ||
    decideReviewOnOpen({ autoReview: input.autoReview, pr }).start
  );
}

/** Only a "request changes" review spawns a work order; an unset state defaults to that. */
export function isChangesRequestedReview(
  reviewState: string | undefined,
): boolean {
  return (reviewState ?? "changes_requested") === "changes_requested";
}

/** Formats a submitted review's body + inline comments, falling back when there is no text. */
export function reviewSubmittedFeedback(
  body: string | undefined,
  inline: ReviewComment[],
): string {
  return (
    reviewFeedback(body ?? "", inline) ||
    "changes requested in a submitted review"
  );
}

const TRUSTED_ASSOCIATIONS = ["OWNER", "MEMBER", "COLLABORATOR"];

/** What a review says becomes the task of an agent that may push, so only someone GitHub attributes write standing to can start one. */
export function isTrustedReviewer(authorAssociation: string): boolean {
  return TRUSTED_ASSOCIATIONS.includes(authorAssociation);
}

/** The per-repo `auto_review` opt-in, read off the repository's settings however they were stored. */
export function autoReviewEnabled(rawSettings: unknown): boolean {
  const parsed =
    typeof rawSettings === "string" ? parsedJson(rawSettings) : rawSettings;

  return (parsed as { auto_review?: boolean } | null)?.auto_review === true;
}

function parsedJson(raw: string): unknown {
  try {
    return JSON.parse(raw);
  } catch {
    return null;
  }
}
