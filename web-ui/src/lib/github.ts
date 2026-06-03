/**
 * GitHub API client for the web-ui.
 * Uses GitHub App authentication (same credentials as MCP server).
 * Only implements getPRDetails needed for PR state visibility.
 */

import { Octokit } from "octokit";
import { createAppAuth } from "@octokit/auth-app";

export type PRStatus =
  | 'draft'
  | 'open'
  | 'checks-failing'
  | 'changes-requested'
  | 'approved'
  | 'merged'
  | 'closed';

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

function split(repo: string): [string, string] {
  const [owner, name] = repo.split("/");
  return [owner, name];
}

async function octokit(): Promise<Octokit> {
  const appId = process.env.GITHUB_APP_ID || "";
  const privateKey = process.env.GITHUB_APP_PRIVATE_KEY || "";
  const installationId = process.env.GITHUB_APP_INSTALLATION_ID || "";
  if (!appId || !privateKey || !installationId) {
    throw new Error("GitHub App credentials not configured");
  }
  return new Octokit({
    authStrategy: createAppAuth,
    auth: { appId, privateKey, installationId },
  });
}

export function isGitHubConfigured(): boolean {
  return !!(process.env.GITHUB_APP_ID && process.env.GITHUB_APP_PRIVATE_KEY && process.env.GITHUB_APP_INSTALLATION_ID);
}

export function computeStatus(
  pr: { merged: boolean; state: string; draft?: boolean },
  checks: Array<{ conclusion: string | null }>,
  reviews: Array<{ state: string }>,
): PRStatus {
  if (pr.merged) return 'merged';
  if (pr.state === 'closed') return 'closed';
  if (pr.draft) return 'draft';
  if (checks.some(c => c.conclusion === 'failure' || c.conclusion === 'timed_out')) return 'checks-failing';
  if (reviews.some(r => r.state === 'CHANGES_REQUESTED')) return 'changes-requested';
  if (
    reviews.some(r => r.state === 'APPROVED') &&
    checks.every(c => c.conclusion === 'success' || c.conclusion === 'skipped' || c.conclusion === null)
  ) return 'approved';
  return 'open';
}

export interface RepoMeta {
  description: string | null;
  default_branch: string;
  html_url: string;
}

/**
 * Check whether each path exists on the repo's default branch.
 * Returns a map of path -> true (exists) / false (404) / null (unknown:
 * App not configured, no repo access, or transient error). Fail-soft.
 */
export async function checkRepoFiles(
  repo: string,
  paths: string[],
): Promise<Record<string, boolean | null>> {
  const result: Record<string, boolean | null> = {};
  if (!isGitHubConfigured()) {
    for (const p of paths) result[p] = null;
    return result;
  }
  const ok = await octokit();
  const [owner, name] = split(repo);
  await Promise.all(
    paths.map(async path => {
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

/**
 * Fetch the decoded UTF-8 content of a file on the repo's default branch.
 * Returns null when the file is absent (404), the App isn't configured, or
 * on any transient error. Fail-soft, like {@link checkRepoFiles}.
 */
export async function getRepoFileContent(repo: string, path: string): Promise<string | null> {
  if (!isGitHubConfigured()) return null;
  const ok = await octokit();
  const [owner, name] = split(repo);
  try {
    const { data } = await ok.rest.repos.getContent({ owner, repo: name, path });
    if (Array.isArray(data) || data.type !== 'file' || typeof data.content !== 'string') return null;
    return Buffer.from(data.content, 'base64').toString('utf-8');
  } catch {
    return null;
  }
}

const isAlreadyExists = (e: unknown): boolean => (e as { status?: number }).status === 422;

/**
 * Open (or reuse) a PR that installs the canonical lore-ingest workflow on
 * `repo`. Idempotent: re-uses a stable branch and the existing open PR if a
 * prior run already opened one. Returns the PR url+number, or null if the
 * App isn't configured.
 */
export async function openIngestWorkflowPR(
  repo: string,
  path: string,
  content: string,
): Promise<{ url: string; number: number } | null> {
  if (!isGitHubConfigured()) return null;
  const ok = await octokit();
  const [owner, name] = split(repo);
  const branch = 'lore/fix-ingest-workflow';

  const { data: repoData } = await ok.rest.repos.get({ owner, repo: name });
  const base = repoData.default_branch;

  const { data: baseRef } = await ok.rest.git.getRef({ owner, repo: name, ref: `heads/${base}` });
  try {
    await ok.rest.git.createRef({ owner, repo: name, ref: `refs/heads/${branch}`, sha: baseRef.object.sha });
  } catch (e) {
    if (!isAlreadyExists(e)) throw e; // branch already exists — commit onto it
  }

  let sha: string | undefined;
  try {
    const { data } = await ok.rest.repos.getContent({ owner, repo: name, path, ref: branch });
    if (!Array.isArray(data) && 'sha' in data) sha = data.sha;
  } catch {
    // file not on the branch yet — create it fresh
  }

  await ok.rest.repos.createOrUpdateFileContents({
    owner,
    repo: name,
    path,
    branch,
    message: `lore: install ${path}`,
    content: Buffer.from(content).toString('base64'),
    ...(sha ? { sha } : {}),
  });

  try {
    const { data: pr } = await ok.rest.pulls.create({
      owner,
      repo: name,
      head: branch,
      base,
      title: 'lore: install context ingest workflow',
      body:
        'This PR installs (or repairs) `.github/workflows/lore-ingest.yml` so pushes to context files trigger Lore re-ingestion.\n\nOpened from the Lore dashboard.',
    });
    return { url: pr.html_url, number: pr.number };
  } catch (e) {
    if (!isAlreadyExists(e)) throw e;
    const { data: existing } = await ok.rest.pulls.list({ owner, repo: name, head: `${owner}:${branch}`, state: 'open' });
    const pr = existing[0];
    return pr ? { url: pr.html_url, number: pr.number } : null;
  }
}

export async function getRepoMeta(repo: string): Promise<RepoMeta | null> {
  if (!isGitHubConfigured()) return null;
  const ok = await octokit();
  const [owner, name] = split(repo);
  const { data } = await ok.rest.repos.get({ owner, repo: name });
  return {
    description: data.description ?? null,
    default_branch: data.default_branch,
    html_url: data.html_url,
  };
}

export interface RepoReadme {
  markdown: string;
  rawBaseUrl: string;
  htmlUrl: string;
}

export async function getReadme(repo: string): Promise<RepoReadme | null> {
  if (!isGitHubConfigured()) return null;
  const ok = await octokit();
  const [owner, name] = split(repo);
  try {
    const { data } = await ok.rest.repos.getReadme({ owner, repo: name });
    const markdown = Buffer.from(data.content, "base64").toString("utf-8");
    const rawBaseUrl = (data.download_url ?? "").replace(/[^/]+$/, "");
    return { markdown, rawBaseUrl, htmlUrl: data.html_url ?? "" };
  } catch {
    return null;
  }
}

export async function getPRDetails(repo: string, prNumber: number): Promise<PRDetails> {
  const ok = await octokit();
  const [owner, repoName] = split(repo);

  const { data: pr } = await ok.rest.pulls.get({ owner, repo: repoName, pull_number: prNumber });

  const [checksResult, reviewsResult] = await Promise.all([
    ok.rest.checks.listForRef({ owner, repo: repoName, ref: pr.head.sha }).catch(() => ({ data: { check_runs: [] } })),
    ok.rest.pulls.listReviews({ owner, repo: repoName, pull_number: prNumber }).catch(() => ({ data: [] })),
  ]);

  const checks = checksResult.data.check_runs.map((c: any) => ({
    name: c.name,
    status: c.status,
    conclusion: c.conclusion ?? null,
  }));

  const reviews = reviewsResult.data.map((r: any) => ({
    user: r.user?.login || 'unknown',
    state: r.state,
    submitted_at: r.submitted_at || '',
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
