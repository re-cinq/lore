/**
 * Consolidated GitHub client — single source of truth for GitHub auth.
 *
 * Prefers GitHub App auth (App ID + Private Key + Installation ID),
 * falls back to GITHUB_TOKEN for environments without App credentials.
 */

import { Octokit } from "octokit";
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

/**
 * Get an authenticated Octokit instance.
 * Prefers App auth, falls back to personal token.
 */
export async function getOctokit(): Promise<Octokit> {
  if (APP_ID && PRIVATE_KEY && INSTALLATION_ID) {
    return new Octokit({
      authStrategy: createAppAuth,
      auth: {
        appId: APP_ID,
        privateKey: PRIVATE_KEY,
        installationId: INSTALLATION_ID,
      },
    });
  }
  const token = process.env.GITHUB_TOKEN;
  if (token) {
    return new Octokit({ auth: token });
  }
  throw new Error(
    "GitHub not configured. Set GITHUB_APP_ID/PRIVATE_KEY/INSTALLATION_ID or GITHUB_TOKEN",
  );
}

/**
 * Get a raw Bearer token (for direct fetch calls).
 * Prefers App installation token, falls back to GITHUB_TOKEN.
 */
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

export async function commitFile(
  repo: string,
  branch: string,
  path: string,
  content: string,
  message: string,
): Promise<void> {
  const octokit = await getOctokit();
  const [owner, repoName] = repo.split("/");
  let sha: string | undefined;
  try {
    const { data } = await octokit.rest.repos.getContent({
      owner,
      repo: repoName,
      path,
      ref: branch,
    });
    if ("sha" in data) sha = data.sha;
  } catch {
    // file doesn't exist yet
  }
  await octokit.rest.repos.createOrUpdateFileContents({
    owner,
    repo: repoName,
    path,
    branch,
    message,
    content: Buffer.from(content).toString("base64"),
    ...(sha ? { sha } : {}),
  });
}

export async function createPR(
  repo: string,
  branch: string,
  title: string,
  body: string,
  baseBranch: string = "main",
  labels: string[] = ["agent-generated"],
): Promise<{ url: string; number: number }> {
  const octokit = await getOctokit();
  const [owner, repoName] = repo.split("/");
  const { data: pr } = await octokit.rest.pulls.create({
    owner,
    repo: repoName,
    title,
    body,
    head: branch,
    base: baseBranch,
  });
  if (labels.length > 0) {
    await octokit.rest.issues.addLabels({
      owner,
      repo: repoName,
      issue_number: pr.number,
      labels,
    });
  }
  return { url: pr.html_url, number: pr.number };
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

/**
 * Fetch live PR state from GitHub via raw REST + Bearer token. Returns
 * null when GitHub is not configured. Extracted verbatim from the
 * lore_get_pr_status MCP tool.
 */
export async function fetchPrStatus(
  repo: string,
  prNumber: number,
): Promise<Record<string, any> | null> {
  const token = await getGitHubToken();
  if (!token) return null;

  async function ghFetch(path: string): Promise<any> {
    const res = await fetch(`https://api.github.com${path}`, {
      headers: {
        Authorization: `Bearer ${token}`,
        Accept: "application/vnd.github+json",
        "X-GitHub-Api-Version": "2022-11-28",
      },
    });
    if (!res.ok)
      throw new Error(`GitHub API ${path}: ${res.status} ${res.statusText}`);
    return res.json();
  }

  const [pr, reviews] = await Promise.all([
    ghFetch(`/repos/${repo}/pulls/${prNumber}`),
    ghFetch(`/repos/${repo}/pulls/${prNumber}/reviews`).catch(() => []),
  ]);

  let checkRuns: any[] = [];
  try {
    const checksResp = await ghFetch(
      `/repos/${repo}/commits/${pr.head.sha}/check-runs`,
    );
    checkRuns = checksResp.check_runs || [];
  } catch {
    /* no checks */
  }

  const checks = checkRuns.map((c: any) => ({
    name: c.name,
    status: c.status,
    conclusion: c.conclusion ?? null,
  }));
  const reviewList = Array.isArray(reviews)
    ? reviews.map((r: any) => ({
        user: r.user?.login || "unknown",
        state: r.state,
        submitted_at: r.submitted_at || "",
      }))
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

/**
 * The badge state web-ui shows for a PR. Pure so the precedence is testable.
 * "approved" requires every check to have *concluded* success/skipped — a check
 * still running (conclusion === null) must NOT count as approved, or the badge
 * flips green before CI finishes.
 */
export function deriveComputedStatus(
  pr: { merged?: boolean; state?: string; draft?: boolean },
  checks: PrCheck[],
  reviews: PrReview[],
): string {
  if (pr.merged) return "merged";
  if (pr.state === "closed") return "closed";
  if (pr.draft) return "draft";
  if (
    checks.some(
      (c) => c.conclusion === "failure" || c.conclusion === "timed_out",
    )
  )
    return "checks-failing";
  if (reviews.some((r) => r.state === "CHANGES_REQUESTED"))
    return "changes-requested";
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
