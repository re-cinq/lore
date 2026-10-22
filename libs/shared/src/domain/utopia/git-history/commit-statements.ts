// One commit of the default branch as a Utopia statement item: Repository contains Commit, the commit's words, author and time, the parents it follows, and the pull request it merges with the issues and the Lore task that pull request names. The files it changed are not named: each would be an entity Utopia resolves against the whole base. Which files a commit changed is read from the repository.

import { mergedPullRequestNumber } from "../../pr-body.js";
import { cutText, joinFragments, type Fragment } from "../fragments.js";
import { commitName, githubPage, pullRequestName } from "../names.js";
import { bodyLinks, trackedStub } from "../github/pull-request-links.js";
import {
  attribute,
  relation,
  type Entity,
  type Statement,
  type StatementItem,
} from "../statements.js";

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
  const stub = trackedStub(repo, "pull", number);
  const head: Fragment = {
    e: stub.e,
    s: [relation(commitName(repo, commit.sha), "merges", name), ...stub.s],
  };

  return joinFragments(head, bodyLinks(repo, name, commit.body));
}
