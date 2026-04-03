/**
 * GitHub implementation of the CodePlatform interface.
 *
 * Uses @octokit/auth-app for GitHub App authentication.
 * This is the only file that imports Octokit — everything else
 * goes through the platform() abstraction.
 */

import { Octokit } from "octokit";
import { createAppAuth } from "@octokit/auth-app";
import type {
  CodePlatform,
  PlatformPR,
  PlatformIssue,
  PullReview,
  ReviewComment,
  PullCommit,
  PRDetails,
  PRStatus,
} from "./platform.js";

// ── Auth ─────────────────────────────────────────────────────────────

const APP_ID = process.env.GITHUB_APP_ID || "";
const PRIVATE_KEY = process.env.GITHUB_APP_PRIVATE_KEY || "";
const INSTALLATION_ID = process.env.GITHUB_APP_INSTALLATION_ID || "";

function split(repo: string): [string, string] {
  const [owner, name] = repo.split("/");
  return [owner, name];
}

async function octokit(): Promise<Octokit> {
  return new Octokit({
    authStrategy: createAppAuth,
    auth: { appId: APP_ID, privateKey: PRIVATE_KEY, installationId: INSTALLATION_ID },
  });
}

// ── Implementation ───────────────────────────────────────────────────

export class GitHubPlatform implements CodePlatform {
  readonly name = "github";

  isConfigured(): boolean {
    return !!(APP_ID && PRIVATE_KEY && INSTALLATION_ID);
  }

  // ── Branches & Commits ──

  async createBranch(repo: string, branch: string, base = "main"): Promise<void> {
    const ok = await octokit();
    const [owner, repoName] = split(repo);
    const { data: ref } = await ok.rest.git.getRef({ owner, repo: repoName, ref: `heads/${base}` });
    try {
      await ok.rest.git.createRef({ owner, repo: repoName, ref: `refs/heads/${branch}`, sha: ref.object.sha });
    } catch (err: any) {
      if (err.status === 422 && err.message?.includes("Reference already exists")) {
        await ok.rest.git.deleteRef({ owner, repo: repoName, ref: `heads/${branch}` });
        await ok.rest.git.createRef({ owner, repo: repoName, ref: `refs/heads/${branch}`, sha: ref.object.sha });
      } else {
        throw err;
      }
    }
  }

  async commitFile(repo: string, branch: string, path: string, content: string, message: string): Promise<void> {
    const ok = await octokit();
    const [owner, repoName] = split(repo);
    let sha: string | undefined;
    for (const ref of [branch, "main"]) {
      try {
        const { data } = await ok.rest.repos.getContent({ owner, repo: repoName, path, ref });
        if ("sha" in data) { sha = data.sha; break; }
      } catch { /* not found */ }
    }
    await ok.rest.repos.createOrUpdateFileContents({
      owner, repo: repoName, path, branch, message,
      content: Buffer.from(content).toString("base64"),
      ...(sha ? { sha } : {}),
    });
  }

  // ── Pull Requests ──

  async createPR(repo: string, branch: string, title: string, body: string, base = "main", labels: string[] = ["agent-generated"]): Promise<PlatformPR> {
    const ok = await octokit();
    const [owner, repoName] = split(repo);
    const { data: pr } = await ok.rest.pulls.create({ owner, repo: repoName, title, body, head: branch, base });
    if (labels.length > 0) {
      await ok.rest.issues.addLabels({ owner, repo: repoName, issue_number: pr.number, labels });
    }
    return { url: pr.html_url, number: pr.number };
  }

  async getPRDiff(repo: string, prNumber: number): Promise<string> {
    const ok = await octokit();
    const [owner, repoName] = split(repo);
    const { data } = await ok.rest.pulls.get({ owner, repo: repoName, pull_number: prNumber, mediaType: { format: "diff" } });
    return data as unknown as string;
  }

  async listPRReviews(repo: string, prNumber: number): Promise<PullReview[]> {
    const ok = await octokit();
    const [owner, repoName] = split(repo);
    const { data } = await ok.rest.pulls.listReviews({ owner, repo: repoName, pull_number: prNumber });
    return data.map(r => ({
      id: r.id, state: r.state, body: r.body || "",
      user: r.user?.login || "unknown", submitted_at: r.submitted_at || "",
    }));
  }

  async listPRComments(repo: string, prNumber: number): Promise<ReviewComment[]> {
    const ok = await octokit();
    const [owner, repoName] = split(repo);
    const { data } = await ok.rest.pulls.listReviewComments({ owner, repo: repoName, pull_number: prNumber });
    return data.map(c => ({
      id: c.id, path: c.path, line: c.line ?? c.original_line ?? null,
      body: c.body, user: c.user?.login || "unknown", created_at: c.created_at,
    }));
  }

  async listPRIssueComments(repo: string, prNumber: number): Promise<{ body: string; user: string; created_at: string }[]> {
    const ok = await octokit();
    const [owner, repoName] = split(repo);
    const { data } = await ok.rest.issues.listComments({ owner, repo: repoName, issue_number: prNumber });
    return data
      .filter(c => !c.body?.startsWith('PR created:') && !c.body?.startsWith('Agent ') && !c.body?.startsWith('Task '))
      .map(c => ({ body: c.body || '', user: c.user?.login || 'unknown', created_at: c.created_at }));
  }

  async listPRCommits(repo: string, prNumber: number): Promise<PullCommit[]> {
    const ok = await octokit();
    const [owner, repoName] = split(repo);
    const { data } = await ok.rest.pulls.listCommits({ owner, repo: repoName, pull_number: prNumber });
    return data.map(c => ({
      sha: c.sha, message: c.commit.message,
      date: c.commit.committer?.date || "",
    }));
  }

  async commentOnPR(repo: string, prNumber: number, body: string): Promise<void> {
    const ok = await octokit();
    const [owner, repoName] = split(repo);
    await ok.rest.issues.createComment({ owner, repo: repoName, issue_number: prNumber, body });
  }

  async addPRLabel(repo: string, prNumber: number, label: string): Promise<void> {
    const ok = await octokit();
    const [owner, repoName] = split(repo);
    await ok.rest.issues.addLabels({ owner, repo: repoName, issue_number: prNumber, labels: [label] });
  }

  // ── Issues ──

  async createIssue(repo: string, title: string, body: string, labels: string[] = ["lore-managed"]): Promise<PlatformIssue> {
    const ok = await octokit();
    const [owner, repoName] = split(repo);
    const { data: issue } = await ok.rest.issues.create({ owner, repo: repoName, title, body, labels });
    return { url: issue.html_url, number: issue.number };
  }

  async commentOnIssue(repo: string, issueNumber: number, body: string): Promise<void> {
    const ok = await octokit();
    const [owner, repoName] = split(repo);
    await ok.rest.issues.createComment({ owner, repo: repoName, issue_number: issueNumber, body });
  }

  async closeIssue(repo: string, issueNumber: number, reason: "completed" | "not_planned" = "completed"): Promise<void> {
    const ok = await octokit();
    const [owner, repoName] = split(repo);
    await ok.rest.issues.update({ owner, repo: repoName, issue_number: issueNumber, state: "closed", state_reason: reason });
  }

  async addIssueLabel(repo: string, issueNumber: number, label: string): Promise<void> {
    const ok = await octokit();
    const [owner, repoName] = split(repo);
    await ok.rest.issues.addLabels({ owner, repo: repoName, issue_number: issueNumber, labels: [label] });
  }

  async getIssueLabels(repo: string, issueNumber: number): Promise<string[]> {
    const ok = await octokit();
    const [owner, repoName] = split(repo);
    const { data: issue } = await ok.rest.issues.get({ owner, repo: repoName, issue_number: issueNumber });
    return issue.labels.map((l: any) => typeof l === 'string' ? l : l.name || '');
  }

  async removeIssueLabel(repo: string, issueNumber: number, label: string): Promise<void> {
    const ok = await octokit();
    const [owner, repoName] = split(repo);
    try {
      await ok.rest.issues.removeLabel({ owner, repo: repoName, issue_number: issueNumber, name: label });
    } catch { /* label might not exist */ }
  }

  // ── PR Details ──

  async getPRDetails(repo: string, prNumber: number): Promise<PRDetails> {
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
      user: r.user?.login || "unknown",
      state: r.state,
      submitted_at: r.submitted_at || "",
    }));

    let computed_status: PRStatus;
    if (pr.merged) {
      computed_status = 'merged';
    } else if (pr.state === 'closed') {
      computed_status = 'closed';
    } else if (pr.draft) {
      computed_status = 'draft';
    } else if (checks.some((c: any) => c.conclusion === 'failure' || c.conclusion === 'timed_out')) {
      computed_status = 'checks-failing';
    } else if (reviews.some((r: any) => r.state === 'CHANGES_REQUESTED')) {
      computed_status = 'changes-requested';
    } else if (reviews.some((r: any) => r.state === 'APPROVED') && checks.every((c: any) => c.conclusion === 'success' || c.conclusion === 'skipped' || c.status !== 'completed' || c.conclusion === null)) {
      computed_status = 'approved';
    } else {
      computed_status = 'open';
    }

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
      computed_status,
    };
  }

  // ── Labels ──

  async createLabels(repo: string, labels: Array<{ name: string; color: string; description: string }>): Promise<void> {
    const ok = await octokit();
    const [owner, repoName] = split(repo);
    for (const label of labels) {
      try {
        await ok.rest.issues.createLabel({ owner, repo: repoName, name: label.name, color: label.color, description: label.description });
      } catch (err: any) {
        if (err.status !== 422) throw err; // 422 = already exists
      }
    }
  }

  // ── Merge status ──

  async isPRMerged(repo: string, prNumber: number): Promise<boolean> {
    const ok = await octokit();
    const [owner, repoName] = split(repo);
    const { data: pr } = await ok.rest.pulls.get({ owner, repo: repoName, pull_number: prNumber });
    return pr.merged;
  }

  // ── Repo Content ──

  async getFileContent(repo: string, path: string, ref?: string): Promise<string | null> {
    const ok = await octokit();
    const [owner, repoName] = split(repo);
    try {
      const { data } = await ok.rest.repos.getContent({ owner, repo: repoName, path, ...(ref ? { ref } : {}) });
      if (!Array.isArray(data) && data.type === "file" && data.content) {
        return Buffer.from(data.content, "base64").toString("utf-8");
      }
      return null;
    } catch { return null; }
  }

  async listDirectory(repo: string, path: string): Promise<string[]> {
    const ok = await octokit();
    const [owner, repoName] = split(repo);
    try {
      const { data } = await ok.rest.repos.getContent({ owner, repo: repoName, path });
      if (Array.isArray(data)) return data.map((e: any) => e.name);
      return [];
    } catch { return []; }
  }

  async listCommitsSince(repo: string, since: string): Promise<Array<{ sha: string; files: string[] }>> {
    const ok = await octokit();
    const [owner, repoName] = split(repo);
    const { data: commits } = await ok.rest.repos.listCommits({ owner, repo: repoName, since, per_page: 100 });
    const result: Array<{ sha: string; files: string[] }> = [];
    for (const c of commits) {
      try {
        const { data: detail } = await ok.rest.repos.getCommit({ owner, repo: repoName, ref: c.sha });
        result.push({ sha: c.sha, files: (detail.files || []).map((f: any) => f.filename) });
      } catch { result.push({ sha: c.sha, files: [] }); }
    }
    return result;
  }

  // ── Repo Config ──

  async setRepoVariable(repo: string, name: string, value: string): Promise<void> {
    const ok = await octokit();
    const [owner, repoName] = split(repo);
    try {
      await ok.rest.actions.updateRepoVariable({ owner, repo: repoName, name, value });
    } catch {
      await ok.rest.actions.createRepoVariable({ owner, repo: repoName, name, value });
    }
  }

  async setRepoSecret(repo: string, name: string, value: string): Promise<void> {
    const ok = await octokit();
    const [owner, repoName] = split(repo);
    const { data: pubKey } = await ok.rest.actions.getRepoPublicKey({ owner, repo: repoName });
    const sodium = (await import("libsodium-wrappers")).default;
    await sodium.ready;
    const keyBytes = sodium.from_base64(pubKey.key, sodium.base64_variants.ORIGINAL);
    const encrypted = sodium.crypto_box_seal(sodium.from_string(value), keyBytes);
    const encryptedB64 = sodium.to_base64(encrypted, sodium.base64_variants.ORIGINAL);
    await ok.rest.actions.createOrUpdateRepoSecret({
      owner, repo: repoName, secret_name: name, encrypted_value: encryptedB64, key_id: pubKey.key_id,
    });
    console.log(`[github] Set secret ${name} on ${repo}`);
  }

  // ── Git Token (for clone/push in Claude Code mode) ──

  async getInstallationToken(): Promise<string> {
    const ok = await octokit();
    const auth = (await ok.auth({ type: "installation" })) as { token: string };
    return auth.token;
  }
}
