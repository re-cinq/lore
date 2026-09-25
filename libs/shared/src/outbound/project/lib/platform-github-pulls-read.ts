import type { Octokit } from "octokit";
import type {
  PullRef,
  PullCommit,
  PullStats,
  PullFileChange,
} from "../pulls/pull-requests-port.js";
import { split, toPullRef } from "./platform-github-support.js";

/** PR metadata reads for PlatformGitHub: listing, stats, commits, and merge/close state. */

export async function list(ok: Octokit, repo: string): Promise<PullRef[]> {
  const [owner, name] = split(repo);
  const { pulls } = ok.rest;
  const rows = await ok.paginate(pulls.list, {
    owner,
    repo: name,
    state: "open",
    per_page: 100,
  });

  return rows.map((pr) => toPullRef(repo, pr));
}

/** Merged PRs at or after `since`. GitHub has no merged-since filter, so closed PRs are read newest-updated first and the window closes on the first page whose last row is older than the cutoff (a merge always updates the PR). */
export async function listMergedSince(
  ok: Octokit,
  repo: string,
  since: string,
): Promise<PullRef[]> {
  const rows = await closedPullsUpdatedSince(ok, repo, since);

  return rows
    .filter((pr) => (pr.merged_at ?? "") >= since)
    .map((pr) => toPullRef(repo, pr));
}

type ClosedPull = Parameters<typeof toPullRef>[1] & { updated_at: string };

async function closedPullsUpdatedSince(
  ok: Octokit,
  repo: string,
  since: string,
): Promise<ClosedPull[]> {
  const [owner, name] = split(repo);
  const { pulls } = ok.rest;
  const pages = ok.paginate.iterator(pulls.list, {
    owner,
    repo: name,
    state: "closed",
    sort: "updated",
    direction: "desc",
    per_page: 100,
  });

  return collectUntil(pages, (page) => (page.at(-1)?.updated_at ?? "") < since);
}

/** Every page up to and including the first one `past` says is beyond the window. */
async function collectUntil(
  pages: AsyncIterable<{ data: ClosedPull[] }>,
  past: (page: ClosedPull[]) => boolean,
): Promise<ClosedPull[]> {
  const rows: ClosedPull[] = [];

  for await (const { data: page } of pages) {
    rows.push(...page);

    if (past(page)) {
      break;
    }
  }

  return rows;
}

export async function get(
  ok: Octokit,
  repo: string,
  number: number,
): Promise<PullRef | null> {
  const [owner, name] = split(repo);
  const { pulls } = ok.rest;

  try {
    const { data: pull } = await pulls.get({
      owner,
      repo: name,
      pull_number: number,
    });

    return toPullRef(repo, pull);
  } catch {
    return null;
  }
}

export async function getDiff(
  ok: Octokit,
  repo: string,
  number: number,
): Promise<string> {
  const [owner, name] = split(repo);
  const { pulls } = ok.rest;
  const { data: diff } = await pulls.get({
    owner,
    repo: name,
    pull_number: number,
    mediaType: { format: "diff" },
  });

  return diff as unknown as string;
}

export async function listCommits(
  ok: Octokit,
  repo: string,
  number: number,
): Promise<PullCommit[]> {
  const [owner, name] = split(repo);
  const { pulls } = ok.rest;
  const commits = await ok.paginate(pulls.listCommits, {
    owner,
    repo: name,
    pull_number: number,
  });

  return commits.map(({ sha, commit }) => ({
    sha,
    message: commit.message,
    date: commit.committer?.date ?? "",
  }));
}

export async function isMerged(
  ok: Octokit,
  repo: string,
  number: number,
): Promise<boolean> {
  const pull = await fetchPull(ok, repo, number);

  return pull.merged;
}

export async function isClosed(
  ok: Octokit,
  repo: string,
  number: number,
): Promise<boolean> {
  const pull = await fetchPull(ok, repo, number);

  return pull.state === "closed" && !pull.merged;
}

export async function getStats(
  ok: Octokit,
  repo: string,
  number: number,
): Promise<PullStats> {
  const pull = await fetchPull(ok, repo, number);

  return {
    files_changed: pull.changed_files,
    additions: pull.additions,
    deletions: pull.deletions,
    comments: pull.comments + pull.review_comments,
    merged_at: pull.merged_at,
    created_at: pull.created_at,
  };
}

/** The one pull read the three single-PR readers above share. */
async function fetchPull(ok: Octokit, repo: string, number: number) {
  const [owner, name] = split(repo);
  const { pulls } = ok.rest;
  const { data: pull } = await pulls.get({
    owner,
    repo: name,
    pull_number: number,
  });

  return pull;
}

export async function changedFileCount(
  ok: Octokit,
  repo: string,
  base: string,
  head: string,
): Promise<number> {
  const [owner, name] = split(repo);
  const { repos } = ok.rest;
  const { data: comparison } = await repos.compareCommitsWithBasehead({
    owner,
    repo: name,
    basehead: `${base}...${head}`,
  });

  return comparison.files?.length ?? 0;
}

export async function listFileChanges(
  ok: Octokit,
  repo: string,
  number: number,
): Promise<PullFileChange[]> {
  const [owner, name] = split(repo);
  const { pulls } = ok.rest;
  const files = await ok.paginate(pulls.listFiles, {
    owner,
    repo: name,
    pull_number: number,
    per_page: 100,
  });

  return files.map(toFileChange);
}

interface ListedFile {
  filename: string;
  status: string;
  additions: number;
  deletions: number;
  patch?: string;
  previous_filename?: string;
}

/** Patch is absent for binaries and files past GitHub's diff cap; null keeps that explicit on the wire. */
function toFileChange(f: ListedFile): PullFileChange {
  return {
    filename: f.filename,
    status: f.status,
    additions: f.additions,
    deletions: f.deletions,
    patch: f.patch ?? null,
    ...(f.previous_filename ? { previousFilename: f.previous_filename } : {}),
  };
}

export async function listFiles(
  ok: Octokit,
  repo: string,
  number: number,
): Promise<string[]> {
  const changes = await listFileChanges(ok, repo, number);

  return changes.map((f) => f.filename);
}

/** The newest `limit` commits on a branch. GitHub lists them newest-first; reversed here so the branch reads like a pull request's commit list. */
export async function listBranchCommits(
  ok: Octokit,
  repo: string,
  branch: string,
  limit: number,
): Promise<PullCommit[]> {
  const [owner, name] = split(repo);
  const { repos } = ok.rest;
  const { data: newestFirst } = await repos.listCommits({
    owner,
    repo: name,
    sha: branch,
    per_page: limit,
  });

  return newestFirst.reverse().map(({ sha, commit }) => ({
    sha,
    message: commit.message,
    date: commit.committer?.date ?? "",
  }));
}
