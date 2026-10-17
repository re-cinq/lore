// A git tag and a published GitHub release as Utopia statement items: the tag points to the commit the commit mirror names, and the release publishes the tag, with its title, author, time and notes.

import {
  cutText,
  joinFragments,
  splitToFit,
  type Fragment,
} from "./fragments.js";
import { commitName, githubPage, releaseName, tagName } from "./names.js";
import { attribute, relation, type StatementItem } from "./statements.js";

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
  /** RFC 3339, the item's doc_time. */
  publishedAt: string;
}

export function tagItems(repo: string, tag: TagEntry): StatementItem[] {
  const name = tagName(repo, tag.name);
  const commit = commitName(repo, tag.sha);

  return [
    {
      externalId: `tag:${tag.name}`,
      e: [
        [repo, "Repository", true],
        [name, "Tag", true],
        [commit, "Commit", true],
      ],
      s: [
        relation(repo, "contains", name),
        attribute(name, "tag", tag.name),
        attribute(name, "permalink", githubPage(name)),
        relation(name, "points_to", commit),
      ],
    },
  ];
}

export function releaseItems(
  repo: string,
  release: ReleaseEntry,
): StatementItem[] {
  const name = releaseName(repo, release.tag);
  const notes = cutText(release.body);
  const parts = notes ? [{ e: [], s: [attribute(name, "text", notes)] }] : [];

  return splitToFit(`release:${release.tag}`, parts, (part) => ({
    doc_time: release.publishedAt,
    ...joinFragments(releaseHead(repo, release), part),
  }));
}

function releaseHead(repo: string, release: ReleaseEntry): Fragment {
  const name = releaseName(repo, release.tag);
  const tag = tagName(repo, release.tag);

  return {
    e: [
      [repo, "Repository", true],
      [name, "Release", true],
      [tag, "Tag", true],
    ],
    s: [
      relation(repo, "contains", name),
      attribute(name, "tag", release.tag),
      attribute(name, "title", release.name || release.tag),
      attribute(name, "author", release.author),
      attribute(name, "published_at", release.publishedAt),
      attribute(name, "permalink", githubPage(name)),
      relation(name, "publishes", tag),
    ],
  };
}
