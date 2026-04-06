/**
 * Consolidated GitHub client — single source of truth for GitHub auth.
 *
 * Prefers GitHub App auth (App ID + Private Key + Installation ID),
 * falls back to GITHUB_TOKEN for environments without App credentials.
 */

import { Octokit } from 'octokit';
import { createAppAuth } from '@octokit/auth-app';

const APP_ID = process.env.GITHUB_APP_ID || '';
const PRIVATE_KEY = process.env.GITHUB_APP_PRIVATE_KEY || '';
const INSTALLATION_ID = process.env.GITHUB_APP_INSTALLATION_ID || '';

export function isGitHubConfigured(): boolean {
  return !!(APP_ID && PRIVATE_KEY && INSTALLATION_ID) || !!process.env.GITHUB_TOKEN;
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
      auth: { appId: APP_ID, privateKey: PRIVATE_KEY, installationId: INSTALLATION_ID },
    });
  }
  const token = process.env.GITHUB_TOKEN;
  if (token) {
    return new Octokit({ auth: token });
  }
  throw new Error('GitHub not configured. Set GITHUB_APP_ID/PRIVATE_KEY/INSTALLATION_ID or GITHUB_TOKEN');
}

/**
 * Get a raw Bearer token (for direct fetch calls).
 * Prefers App installation token, falls back to GITHUB_TOKEN.
 */
export async function getGitHubToken(): Promise<string | null> {
  if (APP_ID && PRIVATE_KEY && INSTALLATION_ID) {
    try {
      const auth = createAppAuth({ appId: APP_ID, privateKey: PRIVATE_KEY, installationId: INSTALLATION_ID });
      const { token } = await auth({ type: "installation" });
      return token;
    } catch { /* fall through */ }
  }
  return process.env.GITHUB_TOKEN || null;
}

// ── Convenience helpers ─────────────────────────────────────────────

export async function createBranch(repo: string, branchName: string, baseBranch: string = 'main'): Promise<void> {
  const octokit = await getOctokit();
  const [owner, repoName] = repo.split('/');
  const { data: ref } = await octokit.rest.git.getRef({ owner, repo: repoName, ref: `heads/${baseBranch}` });
  await octokit.rest.git.createRef({ owner, repo: repoName, ref: `refs/heads/${branchName}`, sha: ref.object.sha });
}

export async function commitFile(
  repo: string, branch: string, path: string, content: string, message: string,
): Promise<void> {
  const octokit = await getOctokit();
  const [owner, repoName] = repo.split('/');
  let sha: string | undefined;
  try {
    const { data } = await octokit.rest.repos.getContent({ owner, repo: repoName, path, ref: branch });
    if ('sha' in data) sha = data.sha;
  } catch {} // file doesn't exist yet
  await octokit.rest.repos.createOrUpdateFileContents({
    owner, repo: repoName, path, branch, message,
    content: Buffer.from(content).toString('base64'),
    ...(sha ? { sha } : {}),
  });
}

export async function createPR(
  repo: string, branch: string, title: string, body: string,
  baseBranch: string = 'main', labels: string[] = ['agent-generated'],
): Promise<{ url: string; number: number }> {
  const octokit = await getOctokit();
  const [owner, repoName] = repo.split('/');
  const { data: pr } = await octokit.rest.pulls.create({ owner, repo: repoName, title, body, head: branch, base: baseBranch });
  if (labels.length > 0) {
    await octokit.rest.issues.addLabels({ owner, repo: repoName, issue_number: pr.number, labels });
  }
  return { url: pr.html_url, number: pr.number };
}

export async function postReviewComment(
  repo: string, prNumber: number, body: string,
  event: 'APPROVE' | 'REQUEST_CHANGES' | 'COMMENT' = 'COMMENT',
): Promise<void> {
  const octokit = await getOctokit();
  const [owner, repoName] = repo.split('/');
  await octokit.rest.pulls.createReview({ owner, repo: repoName, pull_number: prNumber, body, event });
}
