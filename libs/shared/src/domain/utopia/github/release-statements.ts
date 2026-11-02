// A git tag and a published GitHub release as the statements of Utopia's identity source: the tag with its name and the commit it points to, the release with its title and the tag it publishes, so the identifiers exist as exact names before an AI reads the notes.

import { commitName, githubPage, releaseName, tagName } from "../names.js";
import {
  attribute,
  knownAs,
  relation,
  type Entity,
  type Statement,
  type StatementItem,
} from "../statements.js";
import type { ReleaseEntry, TagEntry } from "./release-text.js";

export function tagStatementItems(
  repo: string,
  tag: TagEntry,
): StatementItem[] {
  const subject = tagName(repo, tag.name);
  const commit = commitName(repo, tag.sha);
  const entities: Entity[] = [
    [subject, "Tag", true],
    [commit, "Commit", true],
  ];
  const statements = [
    knownAs(subject, tag.name),
    attribute(subject, "permalink", githubPage(subject)),
    relation(subject, "points_to", commit),
  ];

  return [{ externalId: `tag:${tag.name}`, e: entities, s: statements }];
}

export function releaseStatementItems(
  repo: string,
  release: ReleaseEntry,
): StatementItem[] {
  const subject = releaseName(repo, release.tag);
  const tag = tagName(repo, release.tag);
  const entities: Entity[] = [
    [subject, "Release", true],
    [tag, "Tag", true],
  ];

  return [
    {
      externalId: `release:${release.tag}`,
      doc_time: release.publishedAt,
      e: entities,
      s: releaseStatements(subject, tag, release.name || release.tag),
    },
  ];
}

function releaseStatements(
  release: string,
  tag: string,
  title: string,
): Statement[] {
  return [
    attribute(release, "title", title),
    attribute(release, "permalink", githubPage(release)),
    relation(release, "publishes", tag),
  ];
}
