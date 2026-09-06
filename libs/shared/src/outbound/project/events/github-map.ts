/** GitHub webhook → event mapping: produces zero or more EventInputs per check/PR/review. */

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
  "github.check_run.completed",
  "github.check_suite.completed",
  "github.issue_comment.created",
  "github.issues.labeled",
];

function labelNames(labels: unknown): string[] {
  return Array.isArray(labels)
    ? (labels
        .map((l: { name?: string } | null | undefined) => l?.name)
        .filter(Boolean) as string[])
    : [];
}

function commentAuthor(user?: { login?: string }): string {
  return user?.login ?? "";
}

/** Comment identity the code-review reply handler needs — author drives the bot-loop guard; the payload is an untyped webhook body, so a malformed delivery falls back rather than throwing. */
function commentParams(comment?: {
  id?: number;
  user?: { login?: string };
  body?: string;
}): {
  comment_id: number;
  comment_author: string;
  comment_body: string;
} {
  const c = comment ?? {};

  return {
    comment_id: c.id ?? 0,
    comment_author: commentAuthor(c.user),
    comment_body: c.body ?? "",
  };
}

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
  check_run: (payload, repo, key) =>
    mapCheckCompleted("check_run", payload, repo, key),
  check_suite: (payload, repo, key) =>
    mapCheckCompleted("check_suite", payload, repo, key),
  issue_comment: mapIssueComment,
  pull_request_review_comment: mapReviewComment,
  issues: mapIssueLabeled,
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

function closedPrEvent(
  pr: GitHubPayload,
  prNumber: number,
  repo: string,
  key: string,
): EventInput[] {
  // Emit for merged AND unmerged: specPrMerge guards on `merged`, code-review's onClose finishes on any.
  return [
    {
      eventName: "github.pull_request.closed",
      source: "github",
      params: {
        repo,
        pr_number: prNumber,
        merged: pr.merged === true,
        branch: pr.head?.ref ?? "",
        merge_commit_sha: pr.merge_commit_sha ?? null,
        labels: labelNames(pr.labels),
      },
      dedupeKey: key,
    },
  ];
}

function reviewTriggerEvent(
  action: string,
  prNumber: number,
  repo: string,
  key: string,
): EventInput[] {
  return [
    {
      eventName: `github.pull_request.${action}`,
      source: "github",
      params: { repo, pr_number: prNumber },
      dedupeKey: key,
    },
  ];
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

function reviewFields(review?: {
  id?: number;
  state?: string;
  user?: { login?: string };
  body?: string;
}): {
  review_id: number | null;
  review_state: string;
  review_author: string;
  review_body: string;
} {
  const r = review ?? {};

  return {
    review_id: r.id ?? null,
    review_state: r.state ?? "",
    review_author: commentAuthor(r.user),
    review_body: r.body ?? "",
  };
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

  return [
    {
      eventName: "github.pull_request_review.submitted",
      source: "github",
      params: {
        repo,
        pr_number: prNumber,
        ...reviewFields(payload.review),
      },
      dedupeKey: key,
    },
  ];
}

function mapCheckCompleted(
  eventType: string,
  payload: GitHubPayload,
  repo: string,
  key: string,
): EventInput[] {
  if (payload.action !== "completed") {
    return [];
  }
  const prList: Array<{ number?: number } | null | undefined> =
    payload.check_run?.pull_requests ??
    payload.check_suite?.pull_requests ??
    [];

  return prList
    .filter((pr): pr is { number: number } => typeof pr?.number === "number")
    .map((pr) => ({
      eventName: `github.${eventType}.completed`,
      source: "github" as const,
      params: { repo, pr_number: pr.number },
      dedupeKey: `${key}:${pr.number}`,
    }));
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

  return [
    {
      eventName: "github.issue_comment.created",
      source: "github",
      params: {
        repo,
        pr_number: prNumber,
        ...commentParams(payload.comment),
      },
      dedupeKey: key,
    },
  ];
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

  return [
    {
      eventName: "github.pull_request_review_comment.created",
      source: "github",
      params: {
        repo,
        pr_number: prNumber,
        ...commentParams(payload.comment),
        // Thread root for reply hanging; GitHub replies endpoint keys on it.
        in_reply_to_id: payload.comment?.in_reply_to_id ?? null,
      },
      dedupeKey: key,
    },
  ];
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

  return [
    {
      eventName: "github.issues.labeled",
      source: "github",
      params: {
        repo,
        label,
        issue: issueSummary(issue),
      },
      dedupeKey: key,
    },
  ];
}
