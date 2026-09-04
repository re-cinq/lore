import type { Octokit } from "octokit";
import type { PullDraft } from "../pulls/pull-requests-port.js";
import type {
  PullRef,
  PRReviewEvent,
  CreateReviewInput,
  MergeMethod,
} from "../pulls/pull-requests-port.js";
import { split, toPullRef } from "./platform-github-support.js";

/** PR mutation paths for PlatformGitHub: comments, reviews, labels, merge, open, update. */

export async function comment(
  ok: Octokit,
  repo: string,
  number: number,
  body: string,
): Promise<void> {
  const [owner, name] = split(repo);

  await ok.rest.issues.createComment({
    owner,
    repo: name,
    issue_number: number,
    body,
  });
}

export async function review(
  ok: Octokit,
  repo: string,
  number: number,
  { body, event }: { body: string; event: PRReviewEvent },
): Promise<void> {
  const [owner, name] = split(repo);

  await ok.rest.pulls.createReview({
    owner,
    repo: name,
    pull_number: number,
    body,
    event,
  });
}

export async function createReview(
  ok: Octokit,
  repo: string,
  number: number,
  input: CreateReviewInput,
): Promise<void> {
  const [owner, name] = split(repo);

  await ok.rest.pulls.createReview({
    owner,
    repo: name,
    pull_number: number,
    body: input.body,
    event: input.event,
    comments: input.comments.map((c) => ({
      path: c.path,
      line: c.line,
      ...(c.side ? { side: c.side } : {}),
      body: c.body,
    })),
  });
}

export async function replyToReviewComment(
  ok: Octokit,
  repo: string,
  number: number,
  { commentId, body }: { commentId: number; body: string },
): Promise<void> {
  const [owner, name] = split(repo);

  await ok.rest.pulls.createReplyForReviewComment({
    owner,
    repo: name,
    pull_number: number,
    comment_id: commentId,
    body,
  });
}

export async function addLabel(
  ok: Octokit,
  repo: string,
  number: number,
  label: string,
): Promise<void> {
  const [owner, name] = split(repo);

  await ok.rest.issues.addLabels({
    owner,
    repo: name,
    issue_number: number,
    labels: [label],
  });
}

export async function merge(
  ok: Octokit,
  repo: string,
  number: number,
  method: MergeMethod = "squash",
): Promise<void> {
  const [owner, name] = split(repo);

  await ok.rest.pulls.merge({
    owner,
    repo: name,
    pull_number: number,
    merge_method: method,
  });
}

export async function open(
  ok: Octokit,
  repo: string,
  branch: string,
  { title, body, base, labels = ["agent-generated"], draft = false }: PullDraft,
): Promise<PullRef> {
  const [owner, name] = split(repo);
  const { data: created } = await ok.rest.pulls.create({
    owner,
    repo: name,
    title,
    body,
    head: branch,
    base: base ?? "main",
    draft,
  });

  if (labels.length > 0) {
    await ok.rest.issues.addLabels({
      owner,
      repo: name,
      issue_number: created.number,
      labels,
    });
  }

  return toPullRef(repo, created);
}

export async function update(
  ok: Octokit,
  repo: string,
  number: number,
  fields: { title?: string; body?: string },
): Promise<void> {
  const [owner, name] = split(repo);

  await ok.rest.pulls.update({
    owner,
    repo: name,
    pull_number: number,
    ...(fields.title !== undefined ? { title: fields.title } : {}),
    ...(fields.body !== undefined ? { body: fields.body } : {}),
  });
}

export async function markReady(
  ok: Octokit,
  repo: string,
  number: number,
): Promise<void> {
  const [owner, name] = split(repo);

  // Read first: mutation needs the PR's NODE id (PullRef lacks it) and GitHub errors on an already-ready PR — treat "already ready" as success, not an error.
  const current = (await ok.graphql(
    `query ($owner: String!, $name: String!, $number: Int!) {
      repository(owner: $owner, name: $name) {
        pullRequest(number: $number) { id isDraft }
      }
    }`,
    { owner, name, number },
  )) as {
    repository?: { pullRequest?: { id: string; isDraft: boolean } | null };
  };

  const pr = current.repository?.pullRequest;

  if (!pr?.isDraft) {
    return;
  }

  await ok.graphql(
    `mutation ($pullRequestId: ID!) {
      markPullRequestReadyForReview(input: { pullRequestId: $pullRequestId }) {
        pullRequest { id isDraft }
      }
    }`,
    { pullRequestId: pr.id },
  );
}

export async function resolveReviewThread(
  ok: Octokit,
  threadId: string,
): Promise<void> {
  await ok.graphql(
    `mutation ($threadId: ID!) {
      resolveReviewThread(input: { threadId: $threadId }) {
        thread { id isResolved }
      }
    }`,
    { threadId },
  );
}
