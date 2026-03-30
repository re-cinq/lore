import { Octokit } from "octokit";
import { createAppAuth } from "@octokit/auth-app";

// GitHub App credentials from env
const APP_ID = process.env.GITHUB_APP_ID || "";
const PRIVATE_KEY = process.env.GITHUB_APP_PRIVATE_KEY || "";
const INSTALLATION_ID = process.env.GITHUB_APP_INSTALLATION_ID || "";

export function isConfigured(): boolean {
  return !!(APP_ID && PRIVATE_KEY && INSTALLATION_ID);
}

export async function getOctokit(): Promise<Octokit> {
  if (!isConfigured()) {
    throw new Error(
      "GitHub App not configured. Set GITHUB_APP_ID, GITHUB_APP_PRIVATE_KEY, GITHUB_APP_INSTALLATION_ID",
    );
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

export async function createBranch(
  repo: string,
  branchName: string,
  baseBranch: string = "main",
): Promise<void> {
  const octokit = await getOctokit();
  const [owner, repoName] = repo.split("/");

  // Get the SHA of the base branch
  const { data: ref } = await octokit.rest.git.getRef({
    owner,
    repo: repoName,
    ref: `heads/${baseBranch}`,
  });

  // Create new branch (delete existing if stale from previous attempt)
  try {
    await octokit.rest.git.createRef({
      owner,
      repo: repoName,
      ref: `refs/heads/${branchName}`,
      sha: ref.object.sha,
    });
  } catch (err: any) {
    if (err.status === 422 && err.message?.includes("Reference already exists")) {
      await octokit.rest.git.deleteRef({ owner, repo: repoName, ref: `heads/${branchName}` });
      await octokit.rest.git.createRef({
        owner,
        repo: repoName,
        ref: `refs/heads/${branchName}`,
        sha: ref.object.sha,
      });
    } else {
      throw err;
    }
  }
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

  // Get current file SHA if it exists (check branch first, then main)
  let sha: string | undefined;
  for (const ref of [branch, "main"]) {
    try {
      const { data } = await octokit.rest.repos.getContent({
        owner,
        repo: repoName,
        path,
        ref,
      });
      if ("sha" in data) {
        sha = data.sha;
        break;
      }
    } catch {
      // file doesn't exist on this ref
    }
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

  // Add labels
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

// ── GitHub Issues ─────────────────────────────────────────────────────

/**
 * Create a GitHub Issue on the target repo for a pipeline task.
 */
export async function createIssue(
  repo: string,
  title: string,
  body: string,
  labels: string[] = ["lore-managed"],
): Promise<{ url: string; number: number }> {
  const octokit = await getOctokit();
  const [owner, repoName] = repo.split("/");

  const { data: issue } = await octokit.rest.issues.create({
    owner,
    repo: repoName,
    title,
    body,
    labels,
  });

  return { url: issue.html_url, number: issue.number };
}

/**
 * Post a comment on a GitHub Issue.
 */
export async function commentOnIssue(
  repo: string,
  issueNumber: number,
  body: string,
): Promise<void> {
  const octokit = await getOctokit();
  const [owner, repoName] = repo.split("/");

  await octokit.rest.issues.createComment({
    owner,
    repo: repoName,
    issue_number: issueNumber,
    body,
  });
}

/**
 * Close a GitHub Issue.
 */
export async function closeIssue(
  repo: string,
  issueNumber: number,
  reason: "completed" | "not_planned" = "completed",
): Promise<void> {
  const octokit = await getOctokit();
  const [owner, repoName] = repo.split("/");

  await octokit.rest.issues.update({
    owner,
    repo: repoName,
    issue_number: issueNumber,
    state: "closed",
    state_reason: reason,
  });
}

/**
 * Add a label to a GitHub Issue.
 */
export async function addIssueLabel(
  repo: string,
  issueNumber: number,
  label: string,
): Promise<void> {
  const octokit = await getOctokit();
  const [owner, repoName] = repo.split("/");

  await octokit.rest.issues.addLabels({
    owner,
    repo: repoName,
    issue_number: issueNumber,
    labels: [label],
  });
}

// ── Repo Actions ──────────────────────────────────────────────────────

/**
 * Set a repository Actions variable. Creates or updates.
 */
export async function setRepoVariable(
  repo: string,
  name: string,
  value: string,
): Promise<void> {
  const octokit = await getOctokit();
  const [owner, repoName] = repo.split("/");
  try {
    await octokit.rest.actions.updateRepoVariable({ owner, repo: repoName, name, value });
  } catch {
    await octokit.rest.actions.createRepoVariable({ owner, repo: repoName, name, value });
  }
}

/**
 * Set a repository Actions secret via GitHub API.
 * Encrypts the value using libsodium sealed box (required by GitHub).
 */
export async function setRepoSecret(
  repo: string,
  name: string,
  value: string,
): Promise<void> {
  const octokit = await getOctokit();
  const [owner, repoName] = repo.split("/");

  const { data: pubKey } = await octokit.rest.actions.getRepoPublicKey({
    owner, repo: repoName,
  });

  // Encrypt with libsodium sealed box (what GitHub expects)
  const sodium = (await import("libsodium-wrappers")).default;
  await sodium.ready;
  const keyBytes = sodium.from_base64(pubKey.key, sodium.base64_variants.ORIGINAL);
  const encrypted = sodium.crypto_box_seal(
    sodium.from_string(value),
    keyBytes,
  );
  const encryptedB64 = sodium.to_base64(encrypted, sodium.base64_variants.ORIGINAL);

  await octokit.rest.actions.createOrUpdateRepoSecret({
    owner,
    repo: repoName,
    secret_name: name,
    encrypted_value: encryptedB64,
    key_id: pubKey.key_id,
  });
  console.log(`[agent] Set secret ${name} on ${repo}`);
}
