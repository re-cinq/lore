/** GitHub webhook → event mapping: produces zero or more EventInputs per PR/review/comment. */

import type { EventInsert as EventInput } from "../../events.js";
import { githubDedupeKey } from "./dedupe.js";

const PR_REVIEW_TRIGGER_ACTIONS = new Set([
  "synchronize",
  "opened",
  "reopened",
  "ready_for_review",
]);

/** Every event name `mapGitHubEvent` can produce (the registry must cover each). */
export const GITHUB_EVENT_NAMES: string[] = [
  "github.pull_request.closed",
  ...[...PR_REVIEW_TRIGGER_ACTIONS].map(
    (action) => `github.pull_request.${action}`,
  ),
  "github.pull_request_review.submitted",
  "github.pull_request_review_comment.created",
  "github.issue_comment.created",
  "github.issues.labeled",
  "github.repository.renamed",
];

// eslint-disable-next-line @typescript-eslint/no-explicit-any -- GitHub webhook payload; shape varies by event type and is navigated defensively below
type GitHubPayload = any;

type EventMapper = (
  payload: GitHubPayload,
  repo: string,
  key: string,
) => EventInput[];

const EVENT_MAPPERS: Record<string, EventMapper | undefined> = {
  pull_request: mapPullRequest,
  pull_request_review: mapPullRequestReview,
  issue_comment: mapIssueComment,
  pull_request_review_comment: mapReviewComment,
  issues: mapIssueLabeled,
  repository: mapRepositoryRenamed,
};

export function mapGitHubEvent(
  eventType: string,
  payload: GitHubPayload,
  deliveryId: string,
): EventInput[] {
  const repo: string | undefined = payload?.repository?.full_name;

  if (!repo) {
    return [];
  }
  const mapper = EVENT_MAPPERS[eventType];

  if (!mapper) {
    return [];
  }

  return mapper(payload, repo, githubDedupeKey(deliveryId));
}

function mapPullRequest(
  payload: GitHubPayload,
  repo: string,
  key: string,
): EventInput[] {
  const pr = payload.pull_request;
  const prNumber: number | undefined = pr?.number;

  if (!prNumber) {
    return [];
  }

  if (payload.action === "closed") {
    return closedPrEvent(pr, prNumber, repo, key);
  }

  if (PR_REVIEW_TRIGGER_ACTIONS.has(payload.action)) {
    return reviewTriggerEvent(payload.action, prNumber, repo, key);
  }

  return [];
}

function mapPullRequestReview(
  payload: GitHubPayload,
  repo: string,
  key: string,
): EventInput[] {
  if (payload.action !== "submitted") {
    return [];
  }
  const prNumber: number | undefined = payload.pull_request?.number;

  if (!prNumber) {
    return [];
  }

  return oneEvent(
    "github.pull_request_review.submitted",
    { repo, pr_number: prNumber, ...reviewFields(payload.review) },
    key,
  );
}

function mapIssueComment(
  payload: GitHubPayload,
  repo: string,
  key: string,
): EventInput[] {
  const prNumber: number | undefined = payload.issue?.number;

  if (
    payload.action !== "created" ||
    !payload.issue?.pull_request ||
    !prNumber
  ) {
    return [];
  }

  return oneEvent(
    "github.issue_comment.created",
    { repo, pr_number: prNumber, ...commentParams(payload.comment) },
    key,
  );
}

function mapReviewComment(
  payload: GitHubPayload,
  repo: string,
  key: string,
): EventInput[] {
  const prNumber: number | undefined = payload.pull_request?.number;

  if (payload.action !== "created" || !prNumber) {
    return [];
  }

  return oneEvent(
    "github.pull_request_review_comment.created",
    {
      repo,
      pr_number: prNumber,
      ...commentParams(payload.comment),
      // Thread root for reply hanging; GitHub replies endpoint keys on it.
      in_reply_to_id: payload.comment?.in_reply_to_id ?? null,
    },
    key,
  );
}

function mapIssueLabeled(
  payload: GitHubPayload,
  repo: string,
  key: string,
): EventInput[] {
  if (payload.action !== "labeled") {
    return [];
  }
  const issue = payload.issue;
  const label: string | undefined = payload.label?.name;

  if (!issue || !label) {
    return [];
  }

  return oneEvent(
    "github.issues.labeled",
    { repo, label, issue: issueSummary(issue) },
    key,
  );
}

function mapRepositoryRenamed(
  payload: GitHubPayload,
  repo: string,
  key: string,
): EventInput[] {
  const previousName = previousNameOf(payload.changes?.repository);

  if (payload.action !== "renamed" || !previousName) {
    return [];
  }
  const [owner] = repo.split("/");

  return oneEvent(
    "github.repository.renamed",
    { from: `${owner}/${previousName}`, to: repo },
    key,
  );
}

function closedPrEvent(
  pr: GitHubPayload,
  prNumber: number,
  repo: string,
  key: string,
): EventInput[] {
  // Emit for merged AND unmerged: specPrMerge guards on `merged`, code-review's onClose finishes on any.
  return oneEvent(
    "github.pull_request.closed",
    {
      repo,
      pr_number: prNumber,
      merged: pr.merged === true,
      branch: pr.head?.ref ?? "",
      base_ref: pr.base?.ref ?? "",
      merge_commit_sha: pr.merge_commit_sha ?? null,
      labels: labelNames(pr.labels),
    },
    key,
  );
}

function reviewTriggerEvent(
  action: string,
  prNumber: number,
  repo: string,
  key: string,
): EventInput[] {
  return oneEvent(
    `github.pull_request.${action}`,
    { repo, pr_number: prNumber },
    key,
  );
}

interface SubmittedReview {
  id?: number;
  state?: string;
  user?: { login?: string };
  body?: string;
  author_association?: string;
}

/** `review_author_association` is GitHub's own word on the reviewer's standing; the reply line starts only for one who may write. */
function reviewFields(review: SubmittedReview = {}): Record<string, unknown> {
  return {
    review_id: review.id ?? null,
    review_state: review.state ?? "",
    review_author: commentAuthor(review.user),
    review_author_association: review.author_association ?? "",
    review_body: review.body ?? "",
  };
}

/** Comment identity the review handlers need — author drives the bot-loop guard, and its association is GitHub's word on whether that author may write, which an `@lore review` needs; the payload is an untyped webhook body, so a malformed delivery falls back rather than throwing. */
function commentParams(comment?: {
  id?: number;
  user?: { login?: string };
  author_association?: string;
  body?: string;
}): {
  comment_id: number;
  comment_author: string;
  comment_author_association: string;
  comment_body: string;
} {
  const c = comment ?? {};

  return {
    comment_id: c.id ?? 0,
    comment_author: commentAuthor(c.user),
    comment_author_association: c.author_association ?? "",
    comment_body: c.body ?? "",
  };
}

function issueSummary(issue: GitHubPayload): {
  number: number;
  title: string;
  body: string;
  html_url: string;
  labels: string[];
} {
  return {
    number: issue.number,
    title: issue.title ?? "",
    body: issue.body ?? "",
    html_url: issue.html_url ?? "",
    labels: labelNames(issue.labels),
  };
}

function previousNameOf(change?: {
  name?: { from?: string };
}): string | undefined {
  return change?.name?.from;
}

function commentAuthor(user?: { login?: string }): string {
  return user?.login ?? "";
}

/** The single-event shape every mapper below returns; the source is always `github` here. */
function oneEvent(
  eventName: string,
  params: Record<string, unknown>,
  key: string,
): EventInput[] {
  return [{ eventName, source: "github", params, dedupeKey: key }];
}

function labelNames(labels: unknown): string[] {
  return Array.isArray(labels)
    ? (labels
        .map((l: { name?: string } | null | undefined) => l?.name)
        .filter(Boolean) as string[])
    : [];
}
