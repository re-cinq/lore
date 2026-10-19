// A pull request or an issue as the mirror names it, and the issues and the Lore task a pull request's body names. The commit mirror reaches them through a squash-merge's message and the tracker mirror from GitHub's own record, so both state the same statements about them.

import { linkedIssues, loreTaskIdOf, type LinkedIssue } from "../pr-body.js";
import type { Fragment } from "./fragments.js";
import { githubPage, issueName, pullRequestName, taskName } from "./names.js";
import { attribute, relation } from "./statements.js";

export type TrackedKind = "pull" | "issue";

const KIND_WORD: Record<TrackedKind, string> = {
  pull: "PullRequest",
  issue: "Issue",
};

export function trackedName(
  repo: string,
  kind: TrackedKind,
  number: number,
): string {
  return kind === "pull"
    ? pullRequestName(repo, number)
    : issueName(repo, number);
}

/** The repository contains it, with its number and page: all a commit message tells of a pull request or an issue. */
export function trackedStub(
  repo: string,
  kind: TrackedKind,
  number: number,
): Fragment {
  const name = trackedName(repo, kind, number);

  return {
    e: [[name, KIND_WORD[kind], true]],
    s: [
      relation(repo, "contains", name),
      attribute(name, "number", String(number)),
      attribute(name, "permalink", githubPage(name)),
    ],
  };
}

/** The issues the body closes or refers to, then the Lore task it delivers. */
export function bodyLinks(
  repo: string,
  pullRequest: string,
  body: string,
): Fragment[] {
  return [
    ...linkedIssues(body).map((issue) => issueLink(repo, pullRequest, issue)),
    ...taskLink(repo, pullRequest, loreTaskIdOf(body)),
  ];
}

/** `Closes #N` is a claim to resolve the issue and `Refs #N` only relates to it (the footer of a partial pull request), so each is its own relation. */
function issueLink(
  repo: string,
  pullRequest: string,
  issue: LinkedIssue,
): Fragment {
  const stub = trackedStub(repo, "issue", issue.number);
  const name = issueName(repo, issue.number);

  return {
    e: stub.e,
    s: [
      relation(pullRequest, issue.resolves ? "closes" : "refers_to", name),
      ...stub.s,
    ],
  };
}

function taskLink(
  repo: string,
  pullRequest: string,
  taskId: string | null,
): Fragment[] {
  if (taskId === null) {
    return [];
  }
  const name = taskName(repo, taskId);

  return [
    {
      e: [[name, "Task", true]],
      s: [
        relation(pullRequest, "delivers", name),
        relation(repo, "contains", name),
        attribute(name, "task_id", taskId),
      ],
    },
  ];
}
