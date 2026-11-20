import type { Octokit } from "octokit";
import type {
  ReleaseEntry,
  TagEntry,
} from "../../../domain/utopia/github/release-text.js";
import type {
  ReleaseEdit,
  ReleaseInput,
  ReleaseRecord,
} from "./github-port.js";
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

interface OctokitReleaseDetail {
  id: number;
  tag_name: string;
  name?: string | null;
  body?: string | null;
  draft: boolean;
  html_url: string;
}

export async function createTagRef(
  ok: Octokit,
  repo: string,
  tag: string,
  sha: string,
): Promise<void> {
  const [owner, name] = split(repo);

  const { git } = ok.rest;

  await git.createRef({
    owner,
    repo: name,
    ref: `refs/tags/${tag}`,
    sha,
  });
}

export async function createRelease(
  ok: Octokit,
  repo: string,
  input: ReleaseInput,
): Promise<ReleaseRecord> {
  const [owner, name] = split(repo);
  const { repos } = ok.rest;
  const { data: release } = await repos.createRelease({
    owner,
    repo: name,
    tag_name: input.tag,
    name: input.name,
    body: input.body,
    draft: input.draft ?? false,
  });

  return toReleaseRecord(release);
}

export async function releaseByTag(
  ok: Octokit,
  repo: string,
  tag: string,
): Promise<ReleaseRecord | null> {
  const [owner, name] = split(repo);
  const { repos } = ok.rest;
  const found = await answerOrNull(() =>
    repos.getReleaseByTag({ owner, repo: name, tag }),
  );

  return found ? toReleaseRecord(found.data) : null;
}

export async function updateRelease(
  ok: Octokit,
  repo: string,
  id: number,
  edit: ReleaseEdit,
): Promise<ReleaseRecord> {
  const [owner, name] = split(repo);
  const { repos } = ok.rest;
  const { data: release } = await repos.updateRelease({
    owner,
    repo: name,
    release_id: id,
    ...edit,
  });

  return toReleaseRecord(release);
}

export async function repoVariable(
  ok: Octokit,
  repo: string,
  variableName: string,
): Promise<string | null> {
  const [owner, name] = split(repo);
  const { actions } = ok.rest;
  const found = await answerOrNull(() =>
    actions.getRepoVariable({ owner, repo: name, name: variableName }),
  );

  return found ? found.data.value : null;
}

async function answerOrNull<T>(read: () => Promise<T>): Promise<T | null> {
  try {
    return await read();
  } catch (err) {
    if ((err as { status?: number }).status === 404) {
      return null;
    }

    throw err;
  }
}

export function toReleaseRecord(release: OctokitReleaseDetail): ReleaseRecord {
  return {
    id: release.id,
    tag: release.tag_name,
    name: release.name ?? "",
    body: release.body ?? "",
    draft: release.draft,
    url: release.html_url,
  };
}
