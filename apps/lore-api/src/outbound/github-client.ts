// Single source of truth for GitHub auth; prefers App credentials, falls back to GITHUB_TOKEN

import { Octokit } from "octokit";
import { withoutBlindRetryOnCreates } from "@re-cinq/lore-shared/project/lib/octokit-retry-policy.js";
import { listReviewThreads } from "@re-cinq/lore-shared/project/lib/platform-github-pulls-review-reads.js";
import { octokitOptions } from "@re-cinq/lore-shared/project/lib/platform-github-auth.js";
import type { GithubInstallationsRepository } from "@re-cinq/lore-shared/project/github-installations/github-installations-port.js";
import {
  appAuthOptions,
  getGitHubToken,
  getOctokit,
  githubApiUrl,
  isAppConfigured,
  isGitHubConfigured,
  setGitHubInstallationsPool,
  type GitHubAuthScope,
  type InstallationsSource,
} from "./github-client-auth.js";

export {
  appAuthOptions,
  getGitHubToken,
  getOctokit,
  githubApiUrl,
  isAppConfigured,
  isGitHubConfigured,
  setGitHubInstallationsPool,
  type GitHubAuthScope,
  type InstallationsSource,
};

// ── Convenience helpers ─────────────────────────────────────────────

export async function createBranch(
  repo: string,
  branchName: string,
  baseBranch: string = "main",
): Promise<void> {
  const octokit = await getOctokit({ repo });
  const { git } = octokit.rest;
  const [owner, repoName] = repo.split("/");
  const { data: ref } = await git.getRef({
    owner,
    repo: repoName,
    ref: `heads/${baseBranch}`,
  });

  await git.createRef({
    owner,
    repo: repoName,
    ref: `refs/heads/${branchName}`,
    sha: ref.object.sha,
  });
}

export async function postReviewComment(
  repo: string,
  prNumber: number,
  body: string,
  event: "APPROVE" | "REQUEST_CHANGES" | "COMMENT" = "COMMENT",
): Promise<void> {
  const octokit = await getOctokit({ repo });
  const { pulls } = octokit.rest;
  const [owner, repoName] = repo.split("/");

  await pulls.createReview({
    owner,
    repo: repoName,
    pull_number: prNumber,
    body,
    event,
  });
}

type RawCheckRun = { name: string; status: string; conclusion: string | null };
type RawReview = {
  user?: { login?: string };
  state?: string;
  submitted_at?: string;
};

export async function fetchPrStatus(
  repo: string,
  prNumber: number,
  installations?: GithubInstallationsRepository,
): Promise<Record<string, unknown> | null> {
  const token = await getGitHubToken({ repo, installations });

  if (!token) {
    return null;
  }

  const { pr, checks, reviewList, unresolvedThreads } = await readPr(
    token,
    repo,
    prNumber,
  );

  return toPrStatus(pr, checks, reviewList, unresolvedThreads);
}

// Fetch live PR state via raw REST; returns null if GitHub not configured
/** The PR, its two verdicts and its open review threads. Reviews and threads are fetched alongside the PR; check-runs start as soon as the PR resolves so they run concurrently with reviews and threads. */
async function readPr(token: string, repo: string, prNumber: number) {
  const prFetch = ghFetch(token, `/repos/${repo}/pulls/${prNumber}`);
  const checksFetch = prFetch.then((pr) =>
    fetchCheckRuns(token, repo, (pr.head as { sha: string }).sha),
  );

  const [pr, rawReviews, unresolvedThreads, rawChecks] = await Promise.all([
    prFetch,
    ghFetch(token, `/repos/${repo}/pulls/${prNumber}/reviews`).catch(() => []),
    countUnresolvedThreads(token, repo, prNumber),
    checksFetch,
  ]);

  return {
    pr,
    checks: normalizeChecks(rawChecks),
    reviewList: normalizeReviews(rawReviews),
    unresolvedThreads,
  };
}

/** How many review threads still wait on someone; null when GitHub would not say, so a failed read never passes for a clean PR. Resolution is a GraphQL-only fact, hence octokit rather than {@link ghFetch}. */
async function countUnresolvedThreads(
  token: string,
  repo: string,
  prNumber: number,
): Promise<number | null> {
  try {
    const threads = await listReviewThreads(
      withoutBlindRetryOnCreates(
        new Octokit({ ...octokitOptions(process.env), auth: token }),
      ),
      repo,
      prNumber,
    );

    return threads.filter((thread) => !thread.isResolved).length;
  } catch {
    return null;
  }
}

// Check-runs are best-effort: any failure (missing sha, network) yields no checks.
async function fetchCheckRuns(
  token: string,
  repo: string,
  headSha: string,
): Promise<RawCheckRun[]> {
  try {
    const resp = await ghFetch(
      token,
      `/repos/${repo}/commits/${headSha}/check-runs`,
    );

    return (resp.check_runs as RawCheckRun[] | undefined) || [];
  } catch {
    return [];
  }
}

function normalizeChecks(checkRuns: RawCheckRun[]): PrCheck[] {
  return checkRuns.map((c) => ({
    name: c.name,
    status: c.status,
    conclusion: c.conclusion ?? null,
  }));
}

function normalizeReviews(reviews: unknown): PrReview[] {
  if (!Array.isArray(reviews)) {
    return [];
  }

  return (reviews as RawReview[]).map((r) => ({
    user: r.user?.login || "unknown",
    state: r.state ?? "",
    submitted_at: r.submitted_at || "",
  }));
}

async function ghFetch(
  token: string,
  path: string,
): Promise<Record<string, unknown>> {
  const res = await fetch(githubApiUrl(path, process.env), {
    signal: AbortSignal.timeout(15_000),
    headers: {
      Authorization: `Bearer ${token}`,
      Accept: "application/vnd.github+json",
      "X-GitHub-Api-Version": "2022-11-28",
    },
  });

  if (!res.ok) {
    throw new Error(`GitHub API ${path}: ${res.status} ${res.statusText}`);
  }

  return res.json();
}

/** The wire shape the UI badge reads; the field names are GitHub's own, so they stay snake_case. */
function toPrStatus(
  pr: Record<string, unknown>,
  checks: PrCheck[],
  reviews: PrReview[],
  unresolvedThreads: number | null,
): Record<string, unknown> {
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
    unresolved_threads: unresolvedThreads,
    computed_status: deriveComputedStatus(pr, checks, reviews),
  };
}

export interface PrCheck {
  name?: string;
  status?: string;
  conclusion: string | null;
}
export interface PrReview {
  user: string;
  state: string;
  submitted_at: string;
}

function anyCheckFailed(checks: PrCheck[]): boolean {
  return checks.some(
    (c) => c.conclusion === "failure" || c.conclusion === "timed_out",
  );
}

function anyReviewState(reviews: PrReview[], state: string): boolean {
  return reviews.some((r) => r.state === state);
}

// "approved" requires ALL checks concluded (not running)
function isApproved(checks: PrCheck[], reviews: PrReview[]): boolean {
  return anyReviewState(reviews, "APPROVED") && everyCheckSettled(checks);
}

function everyCheckSettled(checks: PrCheck[]): boolean {
  return checks.every(
    (c) => c.conclusion === "success" || c.conclusion === "skipped",
  );
}

interface PrStatusInput {
  pr: { merged?: boolean; state?: string; draft?: boolean };
  checks: PrCheck[];
  reviews: PrReview[];
}

// Precedence order: merged / closed / draft beat everything else.
const PR_STATUS_RULES: Array<{
  status: string;
  matches: (input: PrStatusInput) => boolean;
}> = [
  { status: "merged", matches: ({ pr }) => !!pr.merged },
  { status: "closed", matches: ({ pr }) => pr.state === "closed" },
  { status: "draft", matches: ({ pr }) => !!pr.draft },
  {
    status: "checks-failing",
    matches: ({ checks }) => anyCheckFailed(checks),
  },
  {
    status: "changes-requested",
    matches: ({ reviews }) => anyReviewState(reviews, "CHANGES_REQUESTED"),
  },
  {
    status: "approved",
    matches: ({ checks, reviews }) => isApproved(checks, reviews),
  },
];

/** Badge state pure function. */
export function deriveComputedStatus(
  pr: { merged?: boolean; state?: string; draft?: boolean },
  checks: PrCheck[],
  reviews: PrReview[],
): string {
  const input: PrStatusInput = { pr, checks, reviews };

  return PR_STATUS_RULES.find((rule) => rule.matches(input))?.status ?? "open";
}
