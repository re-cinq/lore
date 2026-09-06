import type { Octokit } from "octokit";
import type {
  PullRef,
  PullCommit,
  PullStats,
} from "../pulls/pull-requests-port.js";
import { split, toPullRef } from "./platform-github-support.js";

/** PR metadata reads for PlatformGitHub: listing, stats, commits, and merge/close state. */

export async function list(ok: Octokit, repo: string): Promise<PullRef[]> {
  const [owner, name] = split(repo);
  const pulls = await ok.paginate(ok.rest.pulls.list, {
    owner,
    repo: name,
    state: "open",
    per_page: 100,
  });

  return pulls.map((pr) => toPullRef(repo, pr));
}

export async function get(
  ok: Octokit,
  repo: string,
  number: number,
): Promise<PullRef | null> {
  const [owner, name] = split(repo);

  try {
    const { data: pull } = await ok.rest.pulls.get({
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
  const { data: diff } = await ok.rest.pulls.get({
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
  const commits = await ok.paginate(ok.rest.pulls.listCommits, {
    owner,
    repo: name,
    pull_number: number,
  });

  return commits.map((c) => ({
    sha: c.sha,
    message: c.commit.message,
    date: c.commit.committer?.date ?? "",
  }));
}

export async function isMerged(
  ok: Octokit,
  repo: string,
  number: number,
): Promise<boolean> {
  const [owner, name] = split(repo);
  const { data: pull } = await ok.rest.pulls.get({
    owner,
    repo: name,
    pull_number: number,
  });

  return pull.merged;
}

export async function isClosed(
  ok: Octokit,
  repo: string,
  number: number,
): Promise<boolean> {
  const [owner, name] = split(repo);
  const { data: pull } = await ok.rest.pulls.get({
    owner,
    repo: name,
    pull_number: number,
  });

  return pull.state === "closed" && !pull.merged;
}

export async function getStats(
  ok: Octokit,
  repo: string,
  number: number,
): Promise<PullStats> {
  const [owner, name] = split(repo);
  const { data: pull } = await ok.rest.pulls.get({
    owner,
    repo: name,
    pull_number: number,
  });

  return {
    files_changed: pull.changed_files,
    additions: pull.additions,
    deletions: pull.deletions,
    comments: pull.comments + pull.review_comments,
    merged_at: pull.merged_at,
    created_at: pull.created_at,
  };
}

export async function changedFileCount(
  ok: Octokit,
  repo: string,
  base: string,
  head: string,
): Promise<number> {
  const [owner, name] = split(repo);
  const { data: comparison } = await ok.rest.repos.compareCommitsWithBasehead({
    owner,
    repo: name,
    basehead: `${base}...${head}`,
  });

  return comparison.files?.length ?? 0;
}

export async function listFiles(
  ok: Octokit,
  repo: string,
  number: number,
): Promise<string[]> {
  const [owner, name] = split(repo);
  const files = await ok.paginate(ok.rest.pulls.listFiles, {
    owner,
    repo: name,
    pull_number: number,
    per_page: 100,
  });

  return files.map((f) => f.filename);
}
