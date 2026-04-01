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
