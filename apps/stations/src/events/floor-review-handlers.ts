// A pull request's lifecycle, as the bus delivers it, turned into starts and cancels on the external floor. The retry and dead-lettering are the bus's, so a floor out of reach costs a delayed review and not a lost one.
import type { EventHandler } from "@re-cinq/lore-shared/project/events/drain-loop.js";
import {
  isBotActor,
  isChangesRequestedReview,
  isReviewRequest,
  isTrustedReviewer,
} from "@re-cinq/lore-shared/review/code-review-decisions.js";
import {
  closeReviewsForPr,
  reviewOrRecheck,
  startReply,
  startReview,
  type ReviewStartDeps,
} from "@re-cinq/lore-shared/review/floor-review-start.js";

export interface FloorReviewDeps {
  autoReview(repo: string): Promise<boolean>;
  review(repo: string): Promise<ReviewStartDeps>;
}

const PUSHED_OR_OPENED = [
  "github.pull_request.opened",
  "github.pull_request.synchronize",
  "github.pull_request.reopened",
  "github.pull_request.ready_for_review",
];
const COMMENTED = [
  "github.issue_comment.created",
  "github.pull_request_review_comment.created",
];

// The `pipeline.events` params the GitHub map writes (github-map.ts), GitHub-shaped.
interface PullRequestParams {
  repo: string;
  pr_number: number;
}
// eslint-disable-next-line re-lint/no-row-types-outside-models
interface CommentParams extends PullRequestParams {
  comment_author: string;
  comment_author_association?: string;
  comment_body: string;
}
// eslint-disable-next-line re-lint/no-row-types-outside-models
interface ReviewParams extends PullRequestParams {
  review_id?: number | null;
  review_state?: string;
  review_author?: string;
  review_author_association?: string;
}

export const FLOOR_REVIEW_EVENTS: readonly string[] = [
  ...PUSHED_OR_OPENED,
  ...COMMENTED,
  "github.pull_request.closed",
  "github.pull_request_review.submitted",
];

export function floorReviewHandlers(
  deps: FloorReviewDeps,
): Map<string, EventHandler> {
  return new Map<string, EventHandler>([
    ...PUSHED_OR_OPENED.map((name) => [name, onPush(deps)] as const),
    ...COMMENTED.map((name) => [name, onComment(deps)] as const),
    ["github.pull_request.closed", onClose(deps)],
    ["github.pull_request_review.submitted", onReviewSubmitted(deps)],
  ]);
}

function onPush(deps: FloorReviewDeps): EventHandler {
  return async (params) => {
    const { repo, pr_number: prNumber } =
      params as unknown as PullRequestParams;
    const autoReview = await deps.autoReview(repo);

    if (autoReview) {
      await reviewOrRecheck(await deps.review(repo), {
        repo,
        prNumber,
        autoReview,
      });
    }
  };
}

/** Only the explicit `@lore review` drives a comment, and like the run page's button it is asked for by hand: it reviews a draft and passes the `auto_review` opt-in. It spends a review, so only someone who may write to the repository can ask; a bot's own comment is dropped before any call, which is the loop breaker. */
function onComment(deps: FloorReviewDeps): EventHandler {
  return async (params) => {
    const asked = params as unknown as CommentParams;

    if (!asksForReview(asked)) {
      return;
    }

    await startReview(await deps.review(asked.repo), {
      ...targetOf(asked),
      autoReview: true,
      forced: true,
    });
  };
}

function asksForReview(asked: CommentParams): boolean {
  return (
    !isBotActor(asked.comment_author) &&
    isTrustedReviewer(asked.comment_author_association ?? "") &&
    isReviewRequest(asked.comment_body)
  );
}

/** A request-changes review from someone who may write to the repository becomes a work order; an approval, a bot's review or a stranger's starts nothing. */
function onReviewSubmitted(deps: FloorReviewDeps): EventHandler {
  return async (params) => {
    const submitted = params as unknown as ReviewParams;
    const autoReview = await deps.autoReview(submitted.repo);

    if (!autoReview || !ordersWork(submitted)) {
      return;
    }
    await startReply(await deps.review(submitted.repo), {
      ...targetOf(submitted),
      autoReview,
      reviewId: submitted.review_id!,
      reviewAuthor: submitted.review_author ?? "",
    });
  };
}

function ordersWork(submitted: ReviewParams): boolean {
  return (
    Boolean(submitted.review_id) &&
    isChangesRequestedReview(submitted.review_state) &&
    isTrustedReviewer(submitted.review_author_association ?? "")
  );
}

function onClose(deps: FloorReviewDeps): EventHandler {
  return async (params) => {
    const closed = params as unknown as PullRequestParams;
    const { floor } = await deps.review(closed.repo);

    await closeReviewsForPr(floor, targetOf(closed));
  };
}

function targetOf(params: PullRequestParams): {
  repo: string;
  prNumber: number;
} {
  return { repo: params.repo, prNumber: params.pr_number };
}
