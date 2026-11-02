// One commit of the default branch as the standard text an `api` Utopia source takes: who made it, when, on top of which commits, where it lives on GitHub, the pull request, issues and files it names as links and paths, then the message whole. The links are text, not statements: a changed path as an entity is resolved against the whole base, which Utopia's queue could not take (2026-10-17).

import type { IngestDocument } from "../memory/memory-documents.js";
import { markdownDocument, type Field } from "../markdown.js";
import {
  commitName,
  githubPage,
  issueName,
  markdownFilename,
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
export const MAX_FILES_NAMED = 50;

export const PULL_REQUEST_RE = /\(#(\d+)\)\s*$/;

export const ISSUE_RE =
  /\b(close[sd]?|fix(?:e[sd])?|resolve[sd]?|refs?|related:?)\s+#(\d+)/gi;

export function commitDocument(
  repo: string,
  commit: MirroredCommit,
): IngestDocument {
  return {
    external_id: `commit:${commit.sha}`,
    filename: markdownFilename(commit.sha.slice(0, 7), commit.subject),
    content: markdownDocument(
      commit.subject,
      commitFields(repo, commit),
      commit.body,
    ),
    doc_time: commit.authoredAt,
  };
}

function commitFields(repo: string, commit: MirroredCommit): Field[] {
  const parents =
    commit.parents.length > 0 ? commit.parents.join(", ") : "none";

  return [
    ["Commit", `${commit.sha} in ${repo}`],
    ["Author", commit.author],
    ["Date", commit.authoredAt],
    ["Parents", parents],
    ["Link", githubPage(commitName(repo, commit.sha))],
    ...pullRequestField(repo, commit.subject),
    ...issuesField(repo, `${commit.subject}\n${commit.body}`),
    ...filesField(commit.files),
  ];
}

/** A squash merge's subject ends with its pull request's number, `(#2773)`. */
function pullRequestField(repo: string, subject: string): Field[] {
  const number = PULL_REQUEST_RE.exec(subject)?.[1];

  return number
    ? [["Pull request", githubPage(pullRequestName(repo, Number(number)))]]
    : [];
}

/** Each issue the message closes (Closes, Fixes, Resolves) or refers to (Refs, Related), once, in the order named. */
function issuesField(repo: string, message: string): Field[] {
  const links = new Set(
    [...message.matchAll(ISSUE_RE)].map(
      ([, keyword, number]) =>
        `${relationOf(keyword)} ${githubPage(issueName(repo, Number(number)))}`,
    ),
  );

  return links.size > 0 ? [["Issues", [...links].join(", ")]] : [];
}

/** Closes, Fixes and Resolves claim the issue is done; Refs and Related only name it. */
export function issueRelation(keyword: string): "closes" | "refers_to" {
  return /^(clos|fix|resolv)/i.test(keyword) ? "closes" : "refers_to";
}

/** Closes, Fixes and Resolves claim the issue is done; Refs and Related only name it. */
export function issueRelation(keyword: string): "closes" | "refers_to" {
  return /^(clos|fix|resolv)/i.test(keyword) ? "closes" : "refers_to";
}

function relationOf(keyword: string): string {
  return issueRelation(keyword) === "closes" ? "closes" : "refers to";
}

function filesField(files: string[]): Field[] {
  if (files.length === 0) {
    return [];
  }
  const more = files.length - MAX_FILES_NAMED;
  const named = files.slice(0, MAX_FILES_NAMED).join(", ");

  return [["Files changed", `${named}${more > 0 ? ` and ${more} more` : ""}`]];
}
