// A git tag and a published GitHub release as the text an `api` Utopia source takes: the tag with the commit it points to, the release with its title, tag, author, time and page and its notes whole.

import type { IngestDocument } from "../memory/memory-documents.js";
import { markdownDocument, type Field } from "../markdown.js";
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
    filename: `tag-${tag.name}.md`,
    content: markdownDocument(
      `Tag ${tag.name}`,
      [
        ["Tag", `${tag.name} in ${repo}`],
        ["Commit", tag.sha],
        ["Link", githubPage(tagName(repo, tag.name))],
      ],
      "",
    ),
  };
}

export function releaseDocument(
  repo: string,
  release: ReleaseEntry,
): IngestDocument {
  return {
    external_id: `release:${release.tag}`,
    filename: `release-${release.tag}.md`,
    content: markdownDocument(
      release.name || release.tag,
      releaseFields(repo, release),
      release.body,
    ),
    doc_time: release.publishedAt,
  };
}

function releaseFields(repo: string, release: ReleaseEntry): Field[] {
  return [
    ["Release", `${release.tag} in ${repo}`],
    ["Tag", release.tag],
    ["Author", release.author],
    ["Published", release.publishedAt],
    ["Link", githubPage(releaseName(repo, release.tag))],
  ];
}
