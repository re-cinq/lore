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
  if (APP_ID && PRIVATE_KEY && INSTALLATION_ID) {
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
  const token = process.env.GITHUB_TOKEN;

  if (token) {
    return withoutBlindRetryOnCreates(new Octokit({ auth: token }));
  }
  throw new Error(
    "GitHub not configured. Set GITHUB_APP_ID/PRIVATE_KEY/INSTALLATION_ID or GITHUB_TOKEN",
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
  const [owner, repoName] = repo.split("/");
  const { data: ref } = await octokit.rest.git.getRef({
    owner,
    repo: repoName,
    ref: `heads/${baseBranch}`,
  });

  await octokit.rest.git.createRef({
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
  const [owner, repoName] = repo.split("/");

  await octokit.rest.pulls.createReview({
    owner,
    repo: repoName,
    pull_number: prNumber,
    body,
    event,
  });
}

// Fetch live PR state via raw REST; returns null if GitHub not configured
export async function fetchPrStatus(
  repo: string,
  prNumber: number,
): Promise<Record<string, unknown> | null> {
  const token = await getGitHubToken();

  if (!token) {
    return null;
  }

  async function ghFetch(path: string): Promise<Record<string, unknown>> {
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

  const [pr, reviews] = await Promise.all([
    ghFetch(`/repos/${repo}/pulls/${prNumber}`),
    ghFetch(`/repos/${repo}/pulls/${prNumber}/reviews`).catch(() => []),
  ]);

  let checkRuns: Array<{
    name: string;
    status: string;
    conclusion: string | null;
  }> = [];

  try {
    const checksResp = await ghFetch(
      `/repos/${repo}/commits/${(pr.head as { sha: string }).sha}/check-runs`,
    );

    checkRuns = (checksResp.check_runs as typeof checkRuns) || [];
  } catch {
    /* no checks */
  }

  const checks = checkRuns.map((c) => ({
    name: c.name,
    status: c.status,
    conclusion: c.conclusion ?? null,
  }));
  const reviewList = Array.isArray(reviews)
    ? reviews.map(
        (r: {
          user?: { login?: string };
          state?: string;
          submitted_at?: string;
        }) => ({
          user: r.user?.login || "unknown",
          state: r.state ?? "",
          submitted_at: r.submitted_at || "",
        }),
      )
    : [];

  const computed_status = deriveComputedStatus(pr, checks, reviewList);

  return {
    number: pr.number,
    title: pr.title,
    state: pr.state,
    draft: pr.draft ?? false,
    merged: pr.merged,
    mergeable: pr.mergeable ?? null,
    html_url: pr.html_url,
    checks,
    reviews: reviewList,
    computed_status,
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

// Badge state pure function; "approved" requires ALL checks concluded (not running)
export function deriveComputedStatus(
  pr: { merged?: boolean; state?: string; draft?: boolean },
  checks: PrCheck[],
  reviews: PrReview[],
): string {
  if (pr.merged) {
    return "merged";
  }

  if (pr.state === "closed") {
    return "closed";
  }

  if (pr.draft) {
    return "draft";
  }

  if (
    checks.some(
      (c) => c.conclusion === "failure" || c.conclusion === "timed_out",
    )
  ) {
    return "checks-failing";
  }

  if (reviews.some((r) => r.state === "CHANGES_REQUESTED")) {
    return "changes-requested";
  }

  if (
    reviews.some((r) => r.state === "APPROVED") &&
    checks.every(
      (c) => c.conclusion === "success" || c.conclusion === "skipped",
    )
  ) {
    return "approved";
  }

  return "open";
}
