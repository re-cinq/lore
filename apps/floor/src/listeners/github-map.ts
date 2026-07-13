/**
 * Pure GitHub-webhook → event mapping (layer 1). Given the raw webhook
 * (eventType header + parsed payload + the X-GitHub-Delivery id), produce zero or
 * more `EventInput`s. Mirrors the action allow-lists the mcp-server handler used.
 * A check event fans out to one event per backing PR. No IO; the listener does
 * HMAC + insert.
 */

import type { EventInput } from "../main-loop/types.js";
import { githubDedupeKey } from "../main-loop/dedupe.js";

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
        .map((l: { name?: string }) => l?.name)
        .filter(Boolean) as string[])
    : [];
}

/** Comment identity the code-review reply handler needs — author drives the bot-loop guard. */
function commentParams(comment: any): {
  comment_id: number;
  comment_author: string;
  comment_body: string;
} {
  return {
    comment_id: comment?.id,
    comment_author: comment?.user?.login ?? "",
    comment_body: comment?.body ?? "",
  };
}

export function mapGitHubEvent(
  eventType: string,
  payload: any,
  deliveryId: string,
): EventInput[] {
  const repo: string | undefined = payload?.repository?.full_name;

  if (!repo) {
    return [];
  }
  const key = githubDedupeKey(deliveryId);

  if (eventType === "pull_request") {
    const pr = payload.pull_request;
    const prNumber: number | undefined = pr?.number;

    if (!prNumber) {
      return [];
    }

    if (payload.action === "closed") {
      // Emit for merged AND unmerged closes: specPrMerge guards on `merged`, while
      // code-review's onClose must finish its line on any close.
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

    if (PR_REVIEW_TRIGGER_ACTIONS.has(payload.action)) {
      return [
        {
          eventName: `github.pull_request.${payload.action}`,
          source: "github",
          params: { repo, pr_number: prNumber },
          dedupeKey: key,
        },
      ];
    }

    return [];
  }

  if (eventType === "pull_request_review") {
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
        params: { repo, pr_number: prNumber },
        dedupeKey: key,
      },
    ];
  }

  if (eventType === "check_run" || eventType === "check_suite") {
    if (payload.action !== "completed") {
      return [];
    }
    const prList: Array<{ number: number }> =
      payload.check_run?.pull_requests ??
      payload.check_suite?.pull_requests ??
      [];

    return prList
      .filter((pr) => typeof pr?.number === "number")
      .map((pr) => ({
        eventName: `github.${eventType}.completed`,
        source: "github" as const,
        params: { repo, pr_number: pr.number },
        dedupeKey: `${key}:${pr.number}`,
      }));
  }

  if (eventType === "issue_comment") {
    if (payload.action !== "created" || !payload.issue?.pull_request) {
      return [];
    }
    const prNumber: number | undefined = payload.issue?.number;

    if (!prNumber) {
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

  if (eventType === "pull_request_review_comment") {
    if (payload.action !== "created") {
      return [];
    }
    const prNumber: number | undefined = payload.pull_request?.number;

    if (!prNumber) {
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
        },
        dedupeKey: key,
      },
    ];
  }

  if (eventType === "issues") {
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
          issue: {
            number: issue.number,
            title: issue.title ?? "",
            body: issue.body ?? "",
            html_url: issue.html_url ?? "",
            labels: labelNames(issue.labels),
          },
        },
        dedupeKey: key,
      },
    ];
  }

  return [];
}
