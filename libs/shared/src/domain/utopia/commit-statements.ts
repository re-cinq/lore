// One commit of the default branch as a Utopia statement item: Repository contains Commit, the commit's words, author and time, the parents it follows, the pull request it merges with the issues and the Lore task that pull request names, and each path it changes, named as the doc, test and code mirrors name it. What the commit changed inside those files is not claimed here: a test or a statement is reached through the file, from the items CI pushes after the merge.

import {
  linkedIssueNumbers,
  loreTaskIdOf,
  mergedPullRequestNumber,
} from "../pr-body.js";
import {
  cutText,
  joinFragments,
  splitToFit,
  type Fragment,
} from "./fragments.js";
import {
  commitName,
  fileName,
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

export type ChangedFileKind = "spec" | "adr" | "code";

export interface ChangedFile {
  path: string;
  kind: ChangedFileKind;
}

export interface MirroredCommit {
  sha: string;
  parents: string[];
  subject: string;
  body: string;
  author: string;
  /** RFC 3339, the item's doc_time. */
  authoredAt: string;
  files: ChangedFile[];
}

const FILE_KIND_WORD: Record<ChangedFileKind, string> = {
  spec: "Spec",
  adr: "Adr",
  code: "SourceFile",
};

export function commitItems(
  repo: string,
  commit: MirroredCommit,
): StatementItem[] {
  const head = commitHead(repo, commit);
  const parts = commit.files.map((file) => changeFragment(repo, commit, file));

  return splitToFit(`commit:${commit.sha}`, parts, (part) => ({
    doc_time: commit.authoredAt,
    ...joinFragments(head, part),
  }));
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
  const text = cutText(commit.body);

  return [
    attribute(name, "sha", commit.sha),
    attribute(name, "title", commit.subject),
    ...(text ? [attribute(name, "text", text)] : []),
    attribute(name, "author", commit.author),
    attribute(name, "authored_at", commit.authoredAt),
    attribute(name, "permalink", githubPage(name)),
  ];
}

/** The pull request a squash-merged commit names, with the issues and the Lore task its body (the pull request's) names; a commit pushed without one names neither. */
function pullRequestFragment(repo: string, commit: MirroredCommit): Fragment {
  const number = mergedPullRequestNumber(commit.subject);

  if (number === null) {
    return { e: [], s: [] };
  }
  const name = pullRequestName(repo, number);
  const issues = linkedIssueNumbers(commit.body).map((issue) =>
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

function issueFragment(
  repo: string,
  pullRequest: string,
  number: number,
): Fragment {
  const name = issueName(repo, number);

  return {
    e: [[name, "Issue", true]],
    s: [
      relation(pullRequest, "closes", name),
      relation(repo, "contains", name),
      attribute(name, "number", String(number)),
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

function changeFragment(
  repo: string,
  commit: MirroredCommit,
  file: ChangedFile,
): Fragment {
  const name = fileName(repo, file.path);

  return {
    e: [[name, FILE_KIND_WORD[file.kind], true]],
    s: [
      relation(commitName(repo, commit.sha), "changes", name),
      attribute(name, "path", file.path),
    ],
  };
}
