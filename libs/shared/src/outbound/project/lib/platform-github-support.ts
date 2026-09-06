import type { Octokit } from "octokit";
import type { PullRef } from "../pulls/pull-requests-port.js";

/** Splits an `owner/repo` slug into its two path segments for octokit calls. */
export function split(repo: string): [string, string] {
  const [owner, name] = repo.split("/");

  return [owner, name];
}

export function toPullRef(
  repo: string,
  pr: {
    number: number;
    title: string;
    head: { ref: string; sha?: string };
    state: string;
    merged_at?: string | null;
    html_url: string;
    labels?: Array<{ name: string }>;
    user?: { login?: string } | null;
    draft?: boolean;
  },
): PullRef {
  return {
    repo,
    number: pr.number,
    title: pr.title,
    branch: pr.head.ref,
    state: pr.merged_at ? "merged" : (pr.state as "open" | "closed"),
    labels: (pr.labels ?? []).map((l) => l.name),
    url: pr.html_url,
    author: pr.user?.login ?? "",
    draft: pr.draft ?? false,
    headSha: pr.head.sha,
  };
}

/** Repo default branch, shared by listTree and getDefaultBranch. */
export async function defaultBranch(
  ok: Octokit,
  repo: string,
): Promise<string> {
  const [owner, name] = split(repo);
  const { data: repository } = await ok.rest.repos.get({ owner, repo: name });

  return repository.default_branch;
}
