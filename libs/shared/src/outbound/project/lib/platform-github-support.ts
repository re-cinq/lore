import type { Octokit } from "octokit";
import type { PullRef } from "../pulls/pull-requests-port.js";

/** Splits an `owner/repo` slug into its two path segments for octokit calls. */
export function split(repo: string): [string, string] {
  const [owner, name] = repo.split("/");

  return [owner, name];
}

/** The octokit pull-request payload fields `toPullRef` reads. */
interface OctokitPull {
  number: number;
  title: string;
  head: { ref: string; sha?: string };
  base?: { ref: string };
  node_id?: string;
  state: string;
  merged_at?: string | null;
  html_url: string;
  labels?: Array<{ name: string }>;
  user?: { login?: string } | null;
  draft?: boolean;
  mergeable?: boolean | null;
  body?: string | null;
}

export function toPullRef(repo: string, pr: OctokitPull): PullRef {
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
    // Only `pulls.get` returns this; a list read leaves it undefined, which is not the same as null (GitHub still computing).
    mergeable: pr.mergeable,
    ...optionalFieldsOf(pr),
  };
}

function optionalFieldsOf(pr: OctokitPull): Partial<Pick<PullRef, OptionalPullField>> {
  return {
    ...whenPresent("nodeId", pr.node_id),
    ...whenPresent("baseBranch", pr.base?.ref),
    ...whenPresent("mergedAt", pr.merged_at),
    ...whenPresent("body", pr.body),
  };
}

type OptionalPullField = "mergedAt" | "body" | "nodeId" | "baseBranch";

/** GitHub answers an absent value as null; the ref carries the field only when there is one. */
function whenPresent(
  key: OptionalPullField,
  value: string | null | undefined,
): Partial<Pick<PullRef, OptionalPullField>> {
  return value ? { [key]: value } : {};
}

/** Repo default branch, shared by listTree and getDefaultBranch. */
export async function defaultBranch(
  ok: Octokit,
  repo: string,
): Promise<string> {
  const [owner, name] = split(repo);
  const { repos } = ok.rest;
  const { data: repository } = await repos.get({ owner, repo: name });

  return repository.default_branch;
}
