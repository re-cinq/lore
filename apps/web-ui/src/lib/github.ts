/** GitHub API client for web-ui (GitHub App auth, PR state visibility). */

import { Octokit } from "octokit";
import { withoutBlindRetryOnCreates } from "./octokit-retry-policy";
import { createAppAuth } from "@octokit/auth-app";

export type PRStatus =
  | "draft"
  | "open"
  | "checks-failing"
  | "changes-requested"
  | "approved"
  | "merged"
  | "closed";

export interface PRDetails {
  number: number;
  title: string;
  state: string;
  draft: boolean;
  merged: boolean;
  mergeable: boolean | null;
  html_url: string;
  checks: Array<{ name: string; status: string; conclusion: string | null }>;
  reviews: Array<{ user: string; state: string; submitted_at: string }>;
  computed_status: PRStatus;
}

export function split(repo: string): [string, string] {
  const [owner, name] = repo.split("/");

  return [owner, name];
}

function readGithubAppEnv() {
  return {
    appId: process.env.GITHUB_APP_ID ?? "",
    privateKey: process.env.GITHUB_APP_PRIVATE_KEY ?? "",
    installationId: process.env.GITHUB_APP_INSTALLATION_ID ?? "",
  };
}

function hasGithubAppCredentials(
  creds: ReturnType<typeof readGithubAppEnv>,
): boolean {
  return (
    Boolean(creds.appId) &&
    Boolean(creds.privateKey) &&
    Boolean(creds.installationId)
  );
}

export async function octokit(): Promise<Octokit> {
  const creds = readGithubAppEnv();

  if (!hasGithubAppCredentials(creds)) {
    throw new Error("GitHub App credentials not configured");
  }

  return withoutBlindRetryOnCreates(
    new Octokit({
      authStrategy: createAppAuth,
      auth: creds,
    }),
  );
}

export function isGitHubConfigured(): boolean {
  return !!(
    process.env.GITHUB_APP_ID &&
    process.env.GITHUB_APP_PRIVATE_KEY &&
    process.env.GITHUB_APP_INSTALLATION_ID
  );
}

function hasFailingChecks(checks: Array<{ conclusion: string | null }>) {
  return checks.some(
    (c) => c.conclusion === "failure" || c.conclusion === "timed_out",
  );
}

function isApprovedAndPassing(
  reviews: Array<{ state: string }>,
  checks: Array<{ conclusion: string | null }>,
) {
  return (
    reviews.some((r) => r.state === "APPROVED") &&
    checks.every(
      (c) =>
        c.conclusion === "success" ||
        c.conclusion === "skipped" ||
        c.conclusion === null,
    )
  );
}

/** First matching rule wins — same order as the old if-chain, expressed as data instead of branches. */
function statusRules(
  pr: { merged: boolean; state: string; draft?: boolean },
  checks: Array<{ conclusion: string | null }>,
  reviews: Array<{ state: string }>,
): Array<[boolean, PRStatus]> {
  return [
    [pr.merged, "merged"],
    [pr.state === "closed", "closed"],
    [!!pr.draft, "draft"],
    [hasFailingChecks(checks), "checks-failing"],
    [reviews.some((r) => r.state === "CHANGES_REQUESTED"), "changes-requested"],
    [isApprovedAndPassing(reviews, checks), "approved"],
  ];
}

export function computeStatus(
  pr: { merged: boolean; state: string; draft?: boolean },
  checks: Array<{ conclusion: string | null }>,
  reviews: Array<{ state: string }>,
): PRStatus {
  const match = statusRules(pr, checks, reviews).find(([cond]) => cond);

  return match ? match[1] : "open";
}

export type RepoAccess = "ok" | "not-found" | "unknown";

/** Probe: can App see this repo? Definitive 404 or unknown. */
export async function checkRepoAccess(repo: string): Promise<RepoAccess> {
  if (!isGitHubConfigured()) {
    return "unknown";
  }
  const ok = await octokit();
  const [owner, name] = split(repo);

  try {
    await ok.rest.repos.get({ owner, repo: name });

    return "ok";
  } catch (e) {
    return (e as { status?: number }).status === 404 ? "not-found" : "unknown";
  }
}

// GitHub's own repo-response shape (description/default_branch/html_url), not a Lore table row.
// eslint-disable-next-line lore/no-row-types-outside-models
export interface RepoMeta {
  description: string | null;
  default_branch: string;
  html_url: string;
}

/** Check if paths exist on repo's default branch; fail-soft. */
export async function checkRepoFiles(
  repo: string,
  paths: string[],
): Promise<Record<string, boolean | null>> {
  const result: Record<string, boolean | null> = {};

  if (!isGitHubConfigured()) {
    for (const p of paths) {
      result[p] = null;
    }

    return result;
  }
  const ok = await octokit();
  const [owner, name] = split(repo);

  await Promise.all(
    paths.map(async (path) => {
      try {
        await ok.rest.repos.getContent({ owner, repo: name, path });
        result[path] = true;
      } catch (e) {
        result[path] = (e as { status?: number }).status === 404 ? false : null;
      }
    }),
  );

  return result;
}

/** Fetch decoded UTF-8 file content from repo's default branch; null on 404 or unconfigured. */
function isFileWithStringContent(
  content: unknown,
): content is { content: string } {
  if (Array.isArray(content)) {
    return false;
  }
  const c = content as { type?: string; content?: unknown };

  return c.type === "file" && typeof c.content === "string";
}

function nullOnNotFound(e: unknown): null {
  if ((e as { status?: number }).status === 404) {
    return null;
  }
  throw e;
}

export async function getRepoFileContent(
  repo: string,
  path: string,
): Promise<string | null> {
  if (!isGitHubConfigured()) {
    return null;
  }
  const ok = await octokit();
  const [owner, name] = split(repo);

  try {
    const { data: content } = await ok.rest.repos.getContent({
      owner,
      repo: name,
      path,
    });

    if (!isFileWithStringContent(content)) {
      return null;
    }

    return Buffer.from(content.content, "base64").toString("utf-8");
  } catch (e) {
    return nullOnNotFound(e);
  }
}

export {
  openIngestWorkflowPR,
  openTraceImpactWorkflowPR,
} from "./github-workflow-pr";

export async function getRepoMeta(repo: string): Promise<RepoMeta | null> {
  if (!isGitHubConfigured()) {
    return null;
  }
  const ok = await octokit();
  const [owner, name] = split(repo);
  const { data: repository } = await ok.rest.repos.get({ owner, repo: name });

  return {
    description: repository.description ?? null,
    default_branch: repository.default_branch,
    html_url: repository.html_url,
  };
}

export interface RepoReadme {
  markdown: string;
  rawBaseUrl: string;
  htmlUrl: string;
}

export async function getReadme(repo: string): Promise<RepoReadme | null> {
  if (!isGitHubConfigured()) {
    return null;
  }
  const ok = await octokit();
  const [owner, name] = split(repo);

  try {
    const { data: readme } = await ok.rest.repos.getReadme({
      owner,
      repo: name,
    });
    const markdown = Buffer.from(readme.content, "base64").toString("utf-8");
    const rawBaseUrl = (readme.download_url ?? "").replace(/[^/]+$/, "");

    return { markdown, rawBaseUrl, htmlUrl: readme.html_url ?? "" };
  } catch {
    return null;
  }
}

export async function getPRDetails(
  repo: string,
  prNumber: number,
): Promise<PRDetails> {
  const ok = await octokit();
  const [owner, repoName] = split(repo);

  const { data: pr } = await ok.rest.pulls.get({
    owner,
    repo: repoName,
    pull_number: prNumber,
  });

  const [checksResult, reviewsResult] = await Promise.all([
    ok.rest.checks
      .listForRef({ owner, repo: repoName, ref: pr.head.sha })
      .catch(() => ({ data: { check_runs: [] } })),
    ok.rest.pulls
      .listReviews({ owner, repo: repoName, pull_number: prNumber })
      .catch(() => ({ data: [] })),
  ]);

  const checks = checksResult.data.check_runs.map((c) => ({
    name: c.name,
    status: c.status,
    conclusion: c.conclusion ?? null,
  }));

  const reviews = reviewsResult.data.map((r) => ({
    user: r.user?.login || "unknown",
    state: r.state,
    submitted_at: r.submitted_at || "",
  }));

  return {
    number: pr.number,
    title: pr.title,
    state: pr.state,
    draft: pr.draft ?? false,
    merged: pr.merged,
    mergeable: pr.mergeable ?? null,
    html_url: pr.html_url,
    checks,
    reviews,
    computed_status: computeStatus(pr, checks, reviews),
  };
}
