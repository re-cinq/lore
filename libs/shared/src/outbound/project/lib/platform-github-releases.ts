import type { Octokit } from "octokit";
import type {
  ReleaseEntry,
  TagEntry,
} from "../../../domain/utopia/github/release-text.js";
import { split } from "./platform-github-support.js";

interface OctokitRelease {
  tag_name: string;
  name?: string | null;
  body?: string | null;
  draft: boolean;
  author?: { login?: string } | null;
  published_at?: string | null;
}

interface OctokitTag {
  name: string;
  commit: { sha: string };
}

/** The repo's published releases; a draft has no publish time and is no one's to read yet. */
export async function listReleases(
  ok: Octokit,
  repo: string,
): Promise<ReleaseEntry[]> {
  const [owner, name] = split(repo);
  const { repos } = ok.rest;
  const rows: OctokitRelease[] = await ok.paginate(repos.listReleases, {
    owner,
    repo: name,
    per_page: 100,
  });

  return rows.filter(isPublished).map(toReleaseEntry);
}

export async function listTags(ok: Octokit, repo: string): Promise<TagEntry[]> {
  const [owner, name] = split(repo);
  const { repos } = ok.rest;
  const rows: OctokitTag[] = await ok.paginate(repos.listTags, {
    owner,
    repo: name,
    per_page: 100,
  });

  return rows.map((tag) => ({ name: tag.name, sha: tag.commit.sha }));
}

function isPublished(
  release: OctokitRelease,
): release is OctokitRelease & { published_at: string } {
  return !release.draft && Boolean(release.published_at);
}

function toReleaseEntry(
  release: OctokitRelease & { published_at: string },
): ReleaseEntry {
  return {
    tag: release.tag_name,
    name: release.name ?? "",
    body: release.body ?? "",
    author: release.author?.login ?? "",
    publishedAt: release.published_at,
  };
}
