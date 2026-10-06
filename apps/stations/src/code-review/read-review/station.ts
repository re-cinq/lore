import { parsePullRequestUrl } from "@re-cinq/lore-shared/floor/floor-items.js";
import { defineStation } from "@re-cinq/floor-station";
import type { Handle, RunningStation } from "@re-cinq/floor-station";
import type {
  PullReview,
  ReviewComment,
} from "@re-cinq/lore-shared/project/pulls/pull-requests-port.js";
import { projectFor } from "../../outbound/project-boot.js";
import {
  feedbackOf,
  inlineCommentsOf,
  parseReviewId,
  reviewBodyOf,
} from "./read-review.js";

export interface ReviewReadingPulls {
  listReviews(prNumber: number): Promise<PullReview[]>;
  listComments(prNumber: number): Promise<ReviewComment[]>;
}

export interface ReadReviewDeps {
  project(repo: string): Promise<{ pulls: ReviewReadingPulls }>;
}

export function readReviewHandle(deps: ReadReviewDeps): Handle {
  return async (brief) => {
    const { repo, prNumber } = parsePullRequestUrl(brief.needs.pr_url);
    const reviewId = parseReviewId(brief.needs.review_id);
    const { pulls } = await deps.project(repo);
    const [reviews, comments] = await Promise.all([
      pulls.listReviews(prNumber),
      pulls.listComments(prNumber),
    ]);
    const reviewFeedback = feedbackOf(
      reviewBodyOf(reviews, reviewId),
      inlineCommentsOf(comments, reviewId),
    );

    return {
      outcome: "success",
      produced: { review_feedback: reviewFeedback },
    };
  };
}

export function startReadReviewStation(): RunningStation {
  return defineStation(
    "read-review",
    readReviewHandle({ project: projectFor }),
  );
}
