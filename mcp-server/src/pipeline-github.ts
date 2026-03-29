import { Octokit } from 'octokit';
import { createAppAuth } from '@octokit/auth-app';

// GitHub App credentials from env
const APP_ID = process.env.GITHUB_APP_ID || '';
const PRIVATE_KEY = process.env.GITHUB_APP_PRIVATE_KEY || '';
const INSTALLATION_ID = process.env.GITHUB_APP_INSTALLATION_ID || '';

function isConfigured(): boolean {
  return !!(APP_ID && PRIVATE_KEY && INSTALLATION_ID);
}

async function getOctokit(): Promise<Octokit> {
  if (!isConfigured()) {
    throw new Error('GitHub App not configured. Set GITHUB_APP_ID, GITHUB_APP_PRIVATE_KEY, GITHUB_APP_INSTALLATION_ID');
  }
  return new Octokit({
    authStrategy: createAppAuth,
    auth: {
      appId: APP_ID,
      privateKey: PRIVATE_KEY,
      installationId: INSTALLATION_ID,
    },
  });
}

export async function createBranch(repo: string, branchName: string, baseBranch: string = 'main'): Promise<void> {
  const octokit = await getOctokit();
  const [owner, repoName] = repo.split('/');

  // Get the SHA of the base branch
  const { data: ref } = await octokit.rest.git.getRef({
    owner, repo: repoName, ref: `heads/${baseBranch}`,
  });

  // Create new branch
  await octokit.rest.git.createRef({
    owner, repo: repoName,
    ref: `refs/heads/${branchName}`,
    sha: ref.object.sha,
  });
}

export async function commitFile(
  repo: string,
  branch: string,
  path: string,
  content: string,
  message: string
): Promise<void> {
  const octokit = await getOctokit();
  const [owner, repoName] = repo.split('/');

  // Get current file SHA if it exists
  let sha: string | undefined;
  try {
    const { data } = await octokit.rest.repos.getContent({
      owner, repo: repoName, path, ref: branch,
    });
    if ('sha' in data) sha = data.sha;
  } catch {} // file doesn't exist yet

  await octokit.rest.repos.createOrUpdateFileContents({
    owner, repo: repoName, path, branch,
    message,
    content: Buffer.from(content).toString('base64'),
    ...(sha ? { sha } : {}),
  });
}

export async function createPR(
  repo: string,
  branch: string,
  title: string,
  body: string,
  baseBranch: string = 'main',
  labels: string[] = ['agent-generated']
): Promise<{ url: string; number: number }> {
  const octokit = await getOctokit();
  const [owner, repoName] = repo.split('/');

  const { data: pr } = await octokit.rest.pulls.create({
    owner, repo: repoName,
    title, body,
    head: branch,
    base: baseBranch,
  });

  // Add labels
  if (labels.length > 0) {
    await octokit.rest.issues.addLabels({
      owner, repo: repoName,
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
  event: 'APPROVE' | 'REQUEST_CHANGES' | 'COMMENT' = 'COMMENT'
): Promise<void> {
  const octokit = await getOctokit();
  const [owner, repoName] = repo.split('/');

  await octokit.rest.pulls.createReview({
    owner, repo: repoName,
    pull_number: prNumber,
    body, event,
  });
}

export { isConfigured, getOctokit };
