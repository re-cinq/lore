// One commit of the default branch as a Utopia statement item: Repository contains Commit, the commit's words, author and time, the parents it follows, and the pull request it merges with the issues and the Lore task that pull request names. The files it changed are not named: each would be an entity Utopia resolves against the whole base, and a commit is reached from a file through its pull request.

import {
  linkedIssues,
  loreTaskIdOf,
  mergedPullRequestNumber,
  type LinkedIssue,
} from "../pr-body.js";
import { cutText, joinFragments, type Fragment } from "./fragments.js";
import {
  commitName,
  githubPage,
  issueName,
  pullRequestName,
  taskName,
} from "./names.js";
import {
  attribute,
  relation,
  type Entity,
  type Statement,
  type StatementItem,
} from "./statements.js";

export interface MirroredCommit {
  sha: string;
  parents: string[];
  subject: string;
  body: string;
  author: string;
  /** RFC 3339, the item's doc_time. */
  authoredAt: string;
}

export function commitItems(
  repo: string,
  commit: MirroredCommit,
): StatementItem[] {
  return [
    {
      externalId: `commit:${commit.sha}`,
      doc_time: commit.authoredAt,
      ...joinFragments(commitHead(repo, commit), bodyFragment(repo, commit)),
    },
  ];
}

function commitHead(repo: string, commit: MirroredCommit): Fragment {
  const name = commitName(repo, commit.sha);
  const parents = commit.parents.map((sha) => commitName(repo, sha));
  const pullRequest = pullRequestFragment(repo, commit);

  return {
    e: [
      [repo, "Repository", true],
      [name, "Commit", true],
      ...parents.map((parent): Entity => [parent, "Commit", true]),
      ...pullRequest.e,
    ],
    s: [
      relation(repo, "contains", name),
      ...commitAttributes(name, commit),
      ...parents.map((parent) => relation(name, "follows", parent)),
      ...pullRequest.s,
    ],
  };
}

function commitAttributes(name: string, commit: MirroredCommit): Statement[] {
  return [
    attribute(name, "sha", commit.sha),
    attribute(name, "title", commit.subject),
    attribute(name, "author", commit.author),
    attribute(name, "authored_at", commit.authoredAt),
    attribute(name, "permalink", githubPage(name)),
  ];
}

function bodyFragment(repo: string, commit: MirroredCommit): Fragment[] {
  const text = cutText(commit.body);

  return text
    ? [{ e: [], s: [attribute(commitName(repo, commit.sha), "text", text)] }]
    : [];
}

/** The pull request a squash-merged commit names, with the issues and the Lore task its body (the pull request's) names; a commit pushed without one names neither. */
function pullRequestFragment(repo: string, commit: MirroredCommit): Fragment {
  const number = mergedPullRequestNumber(commit.subject);

  if (number === null) {
    return { e: [], s: [] };
  }
  const name = pullRequestName(repo, number);
  const issues = linkedIssues(commit.body).map((issue) =>
    issueFragment(repo, name, issue),
  );
  const task = taskFragment(repo, name, loreTaskIdOf(commit.body));

  return joinFragments(pullRequestHead(repo, commit.sha, name, number), [
    ...issues,
    task,
  ]);
}

function pullRequestHead(
  repo: string,
  sha: string,
  name: string,
  number: number,
): Fragment {
  return {
    e: [[name, "PullRequest", true]],
    s: [
      relation(commitName(repo, sha), "merges", name),
      relation(repo, "contains", name),
      attribute(name, "number", String(number)),
      attribute(name, "permalink", githubPage(name)),
    ],
  };
}

/** `Closes #N` is a claim to resolve the issue and `Refs #N` only relates to it (the footer of a partial pull request), so each is its own relation. */
function issueFragment(
  repo: string,
  pullRequest: string,
  issue: LinkedIssue,
): Fragment {
  const name = issueName(repo, issue.number);

  return {
    e: [[name, "Issue", true]],
    s: [
      relation(pullRequest, issue.resolves ? "closes" : "refers_to", name),
      relation(repo, "contains", name),
      attribute(name, "number", String(issue.number)),
      attribute(name, "permalink", githubPage(name)),
    ],
  };
}

function taskFragment(
  repo: string,
  pullRequest: string,
  taskId: string | null,
): Fragment {
  if (taskId === null) {
    return { e: [], s: [] };
  }
  const name = taskName(repo, taskId);

  return {
    e: [[name, "Task", true]],
    s: [
      relation(pullRequest, "delivers", name),
      relation(repo, "contains", name),
      attribute(name, "task_id", taskId),
    ],
  };
}
