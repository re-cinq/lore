// The done check's read of what already changed a file (specs/external-floor FR12.20): the merged pull requests behind the default branch's newest commits that touched it.
import type { Octokit } from "octokit";
import type { PullRef } from "../pulls/pull-requests-port.js";
import type { ReposApi } from "./platform-github-api.js";
import { split, toPullRef } from "./platform-github-support.js";

/** Commits per path the done check reads: enough to reach work merged weeks before its ticket was filed. */
const COMMITS_PER_PATH = 20;

/** The merged pull requests behind the newest commits of the default branch that touched `path`, each once. */
export async function mergedPullsTouching(
  ok: Octokit,
  repo: string,
  path: string,
): Promise<PullRef[]> {
  const [owner, name] = split(repo);
  const { repos } = ok.rest;
  const { data: commits } = await repos.listCommits({
    owner,
    repo: name,
    path,
    per_page: COMMITS_PER_PATH,
  });
  const behind = await Promise.all(
    commits.map(({ sha }) => mergedPullsOf(repos, { owner, name }, sha)),
  );
  const unique = new Map(behind.flat().map((pull) => [pull.number, pull]));

  return [...unique.values()].map((pull) => toPullRef(repo, pull));
}

async function mergedPullsOf(
  repos: ReposApi,
  { owner, name }: { owner: string; name: string },
  sha: string,
) {
  const { data: pulls } = await repos.listPullRequestsAssociatedWithCommit({
    owner,
    repo: name,
    commit_sha: sha,
  });

  return pulls.filter((pull) => pull.merged_at);
}
