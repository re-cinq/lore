// A git tag and a published GitHub release as the text an `api` Utopia source takes: the tag with the commit it points to, the release with its title, tag, author, time and page and its notes whole.

import type { IngestDocument } from "../memory/memory-documents.js";
import { githubPage, releaseName, tagName } from "../names.js";

export interface TagEntry {
  name: string;
  /** The commit the tag points to. */
  sha: string;
}

export interface ReleaseEntry {
  tag: string;
  /** Empty when the release was given none; its tag titles it then. */
  name: string;
  body: string;
  /** The GitHub login that published it. */
  author: string;
  /** RFC 3339, the document's doc_time. */
  publishedAt: string;
}

export function tagDocument(repo: string, tag: TagEntry): IngestDocument {
  return {
    external_id: `tag:${tag.name}`,
    filename: `tag-${tag.name}`,
    content: [
      `Tag ${tag.name} in ${repo}`,
      `Commit: ${tag.sha}`,
      `Link: ${githubPage(tagName(repo, tag.name))}`,
    ].join("\n"),
  };
}

export function releaseDocument(
  repo: string,
  release: ReleaseEntry,
): IngestDocument {
  const head = [
    `Release ${release.tag} in ${repo}: ${release.name || release.tag}`,
    `Tag: ${release.tag}`,
    `Author: ${release.author}`,
    `Published: ${release.publishedAt}`,
    `Link: ${githubPage(releaseName(repo, release.tag))}`,
  ].join("\n");

  return {
    external_id: `release:${release.tag}`,
    filename: `release-${release.tag}`,
    content: [head, release.body].filter((part) => part !== "").join("\n\n"),
    doc_time: release.publishedAt,
  };
}
