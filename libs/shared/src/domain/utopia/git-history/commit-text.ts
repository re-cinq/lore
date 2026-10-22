// One commit of the default branch as the standard text an `api` Utopia source takes: who made it, when, on top of which commits, where it lives on GitHub, then the message whole. It names no file the commit changed; which files a commit changed is read from the repository.

import type { IngestDocument } from "../memory/memory-documents.js";
import { commitName, githubPage } from "../names.js";

export interface MirroredCommit {
  sha: string;
  parents: string[];
  subject: string;
  body: string;
  author: string;
  /** RFC 3339, the document's doc_time. */
  authoredAt: string;
}

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
  ];
}
