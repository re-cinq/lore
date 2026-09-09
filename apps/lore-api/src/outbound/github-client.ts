// Single source of truth for GitHub auth; prefers App credentials, falls back to GITHUB_TOKEN

import { Octokit } from "octokit";
import { withoutBlindRetryOnCreates } from "@re-cinq/lore-shared/project/lib/octokit-retry-policy.js";
import { createAppAuth } from "@octokit/auth-app";

const APP_ID = process.env.GITHUB_APP_ID || "";
const PRIVATE_KEY = process.env.GITHUB_APP_PRIVATE_KEY || "";
const INSTALLATION_ID = process.env.GITHUB_APP_INSTALLATION_ID || "";

export function isGitHubConfigured(): boolean {
  return (
    !!(APP_ID && PRIVATE_KEY && INSTALLATION_ID) || !!process.env.GITHUB_TOKEN
  );
}

export function isAppConfigured(): boolean {
  return !!(APP_ID && PRIVATE_KEY && INSTALLATION_ID);
}

// Authenticated Octokit; prefers App auth, falls back to personal token
export async function getOctokit(): Promise<Octokit> {
  if (isAppConfigured()) {
    return appAuthOctokit();
  }
  const token = process.env.GITHUB_TOKEN;

  if (token) {
    return withoutBlindRetryOnCreates(new Octokit({ auth: token }));
  }
  throw new Error(
    "GitHub not configured. Set GITHUB_APP_ID/PRIVATE_KEY/INSTALLATION_ID or GITHUB_TOKEN",
  );
}

// App auth mints its own installation token per call, so no token is read from the environment here.
function appAuthOctokit(): Octokit {
  return withoutBlindRetryOnCreates(
    new Octokit({
      authStrategy: createAppAuth,
      auth: {
        appId: APP_ID,
        privateKey: PRIVATE_KEY,
        installationId: INSTALLATION_ID,
      },
    }),
  );
}

// Raw Bearer token for direct fetch calls; prefers App token, falls back to GITHUB_TOKEN
export async function getGitHubToken(): Promise<string | null> {
  if (APP_ID && PRIVATE_KEY && INSTALLATION_ID) {
    try {
      const auth = createAppAuth({
        appId: APP_ID,
        privateKey: PRIVATE_KEY,
        installationId: INSTALLATION_ID,
      });
      const { token } = await auth({ type: "installation" });

      return token;
    } catch {
      /* fall through */
    }
  }

  return process.env.GITHUB_TOKEN || null;
}

// ── Convenience helpers ─────────────────────────────────────────────

export async function createBranch(
  repo: string,
  branchName: string,
  baseBranch: string = "main",
): Promise<void> {
  const octokit = await getOctokit();
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
  const octokit = await getOctokit();
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
): Promise<Record<string, unknown> | null> {
  const token = await getGitHubToken();

  if (!token) {
    return null;
  }

  const { pr, checks, reviewList } = await readPr(token, repo, prNumber);

  return toPrStatus(pr, checks, reviewList);
}

// Fetch live PR state via raw REST; returns null if GitHub not configured
/** The PR and its two verdicts. Reviews are fetched alongside the PR and their failure swallowed — a PR nobody has reviewed yet is the normal case, and it must not cost the checks. The check runs need the head SHA, so they follow rather than join the pair. */
async function readPr(token: string, repo: string, prNumber: number) {
  const [pr, rawReviews] = await Promise.all([
    ghFetch(token, `/repos/${repo}/pulls/${prNumber}`),
    ghFetch(token, `/repos/${repo}/pulls/${prNumber}/reviews`).catch(() => []),
  ]);

  return {
    pr,
    checks: normalizeChecks(
      await fetchCheckRuns(token, repo, (pr.head as { sha: string }).sha),
    ),
    reviewList: normalizeReviews(rawReviews),
  };
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
  const res = await fetch(`https://api.github.com${path}`, {
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
