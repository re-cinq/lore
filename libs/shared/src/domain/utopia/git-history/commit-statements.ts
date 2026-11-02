// One commit of the default branch as the statements of Utopia's identity source: its name and short sha, its title and link, the commit it follows, the pull request its subject merges, the first files it changes and who wrote it, so the identifiers exist as exact names before an AI reads the commit's prose.

import {
  cutText,
  joinFragments,
  splitToFit,
  type Fragment,
} from "../fragments.js";
import { commitName, fileName, githubPage, pullRequestName } from "../names.js";
import {
  attribute,
  knownAs,
  relation,
  sourceFileStatements,
  type StatementItem,
} from "../statements.js";
import { authorFragment } from "../author.js";
import {
  MAX_FILES_NAMED,
  PULL_REQUEST_RE,
  type MirroredCommit,
} from "./commit-text.js";

export function commitStatementItems(
  repo: string,
  commit: MirroredCommit,
): StatementItem[] {
  const subject = commitName(repo, commit.sha);
  const head = headOf(subject, commit);
  const changedFiles = commit.files.slice(0, MAX_FILES_NAMED);
  const parts = [
    ...commit.parents.map((parent) => parentFragment(repo, subject, parent)),
    ...pullRequestFragments(repo, subject, commit.subject),
    ...changedFiles.map((path) => fileFragment(repo, subject, path)),
  ];

  return splitToFit(`commit:${commit.sha}`, parts, (part) =>
    joinFragments(head, part),
  ).map((pushed) => ({ ...pushed, doc_time: commit.authoredAt }));
}

function headOf(subject: string, commit: MirroredCommit): Fragment {
  const author = authorFragment(subject, commit.author);

  return {
    e: [[subject, "Commit", true], ...author.e],
    s: [
      knownAs(subject, commit.sha.slice(0, 7)),
      attribute(subject, "title", cutText(commit.subject)),
      attribute(subject, "permalink", githubPage(subject)),
      ...author.s,
    ],
  };
}

function parentFragment(
  repo: string,
  subject: string,
  parent: string,
): Fragment {
  const name = commitName(repo, parent);

  return {
    e: [[name, "Commit", true]],
    s: [relation(subject, "follows", name)],
  };
}

function pullRequestFragments(
  repo: string,
  subject: string,
  title: string,
): Fragment[] {
  const number = PULL_REQUEST_RE.exec(title)?.[1];

  if (!number) {
    return [];
  }
  const pull = pullRequestName(repo, Number(number));

  return [
    {
      e: [[pull, "PullRequest", true]],
      s: [relation(subject, "merges", pull)],
    },
  ];
}

function fileFragment(repo: string, subject: string, path: string): Fragment {
  const file = fileName(repo, path);

  return {
    e: [[file, "SourceFile", true]],
    s: [
      relation(subject, "changes", file),
      ...sourceFileStatements(file, path),
    ],
  };
}
