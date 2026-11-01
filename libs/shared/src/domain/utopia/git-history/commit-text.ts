// One commit of the default branch as the standard text an `api` Utopia source takes: who made it, when, on top of which commits, where it lives on GitHub, the pull request, issues and files it names as links and paths, then the message whole. The links are text, not statements: a changed path as an entity is resolved against the whole base, which Utopia's queue could not take (2026-10-17).

import type { IngestDocument } from "../memory/memory-documents.js";
import {
  commitName,
  githubPage,
  issueName,
  pullRequestName,
} from "../names.js";

export interface MirroredCommit {
  sha: string;
  parents: string[];
  subject: string;
  body: string;
  author: string;
  /** RFC 3339, the document's doc_time. */
  authoredAt: string;
  /** The paths the commit added, modified, renamed or deleted. */
  files: string[];
}

/** A commit touching more files than this names the first ones and how many more: a mass rename says nothing per file. */
const MAX_FILES_NAMED = 50;

const PULL_REQUEST_RE = /\(#(\d+)\)\s*$/;

const ISSUE_RE =
  /\b(close[sd]?|fix(?:e[sd])?|resolve[sd]?|refs?|related:?)\s+#(\d+)/gi;

export function commitDocument(
  repo: string,
  commit: MirroredCommit,
): IngestDocument {
  const message = [commit.subject, commit.body].filter((part) => part !== "");

  return {
    external_id: `commit:${commit.sha}`,
    filename: `commit-${commit.sha}`,
    content: [...commitHead(repo, commit), "", message.join("\n\n")].join("\n"),
    doc_time: commit.authoredAt,
  };
}

function commitHead(repo: string, commit: MirroredCommit): string[] {
  const parents =
    commit.parents.length > 0 ? commit.parents.join(", ") : "none";

  return [
    `Commit ${commit.sha} in ${repo}`,
    `Author: ${commit.author}`,
    `Date: ${commit.authoredAt}`,
    `Parents: ${parents}`,
    `Link: ${githubPage(commitName(repo, commit.sha))}`,
    ...pullRequestLine(repo, commit.subject),
    ...issuesLine(repo, `${commit.subject}\n${commit.body}`),
    ...filesLine(commit.files),
  ];
}

/** A squash merge's subject ends with its pull request's number, `(#2773)`. */
function pullRequestLine(repo: string, subject: string): string[] {
  const number = PULL_REQUEST_RE.exec(subject)?.[1];

  return number
    ? [`Pull request: ${githubPage(pullRequestName(repo, Number(number)))}`]
    : [];
}

/** Each issue the message closes (Closes, Fixes, Resolves) or refers to (Refs, Related), once, in the order named. */
function issuesLine(repo: string, message: string): string[] {
  const links = new Set(
    [...message.matchAll(ISSUE_RE)].map(
      ([, keyword, number]) =>
        `${relationOf(keyword)} ${githubPage(issueName(repo, Number(number)))}`,
    ),
  );

  return links.size > 0 ? [`Issues: ${[...links].join(", ")}`] : [];
}

function relationOf(keyword: string): string {
  return /^(clos|fix|resolv)/i.test(keyword) ? "closes" : "refers to";
}

function filesLine(files: string[]): string[] {
  if (files.length === 0) {
    return [];
  }
  const more = files.length - MAX_FILES_NAMED;
  const named = files.slice(0, MAX_FILES_NAMED).join(", ");

  return [`Files changed: ${named}${more > 0 ? ` and ${more} more` : ""}`];
}
