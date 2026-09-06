import type { Octokit } from "octokit";
import type { FileChange } from "./github-port.js";
import type { PullDraft } from "../pulls/pull-requests-port.js";
import { buildOctokit } from "./platform-github-auth.js";
import type {
  GitHubPort,
  IssueRef,
  IssueFilter,
  IssueState,
  CloseReason,
  CheckRunInput,
} from "./github-port.js";
import type {
  PullRequestsPort,
  PullRef,
  PRReviewEvent,
  CreateReviewInput,
  MergeMethod,
  PullReview,
  ReviewComment,
  IssueComment,
  PullCommit,
  PullStats,
  CiConclusion,
  CheckRun,
  ReviewThread,
} from "../pulls/pull-requests-port.js";
import { defaultBranch as fetchDefaultBranch } from "./platform-github-support.js";
import * as issues from "./platform-github-issues.js";
import * as repoContent from "./platform-github-repo-content.js";
import * as repoConfig from "./platform-github-repo-config.js";
import * as pullsRead from "./platform-github-pulls-read.js";
import * as pullsReviewReads from "./platform-github-pulls-review-reads.js";
import * as pullsWrite from "./platform-github-pulls-write.js";

export type { IssueState, CloseReason };

/** One GitHub adapter satisfying BOTH GitHubPort and PullRequestsPort (auth relocated from mcp-server/github-client.ts, REST from agent/github.ts); octokit is imported lazily so the module loads where it's absent. Method bodies delegate to the sibling `platform-github-*` modules, grouped by job (issues, repo content/config, PR reads, PR review reads, PR writes). */
export class PlatformGitHub implements GitHubPort, PullRequestsPort {
  readonly name = "github";
  private client?: Promise<Octokit>;

  constructor(private readonly env: NodeJS.ProcessEnv = process.env) {}

  isConfigured(): boolean {
    const {
      GITHUB_APP_ID,
      GITHUB_APP_PRIVATE_KEY,
      GITHUB_APP_INSTALLATION_ID,
      GITHUB_TOKEN,
    } = this.env;

    return (
      (!!GITHUB_APP_ID &&
        !!GITHUB_APP_PRIVATE_KEY &&
        !!GITHUB_APP_INSTALLATION_ID) ||
      !!GITHUB_TOKEN
    );
  }

  // ── GitHubPort: issues ────────────────────────────────────────────────

  async listIssues(repo: string, filter?: IssueFilter): Promise<IssueRef[]> {
    return issues.listIssues(await this.octo(), repo, filter);
  }

  async getIssue(repo: string, number: number): Promise<IssueRef | null> {
    return issues.getIssue(await this.octo(), repo, number);
  }

  async getIssueLabels(repo: string, number: number): Promise<string[]> {
    return issues.getIssueLabels(await this.octo(), repo, number);
  }

  async createIssue(
    repo: string,
    title: string,
    body: string,
    labels: string[] = ["lore-managed"],
  ): Promise<IssueRef> {
    return issues.createIssue(await this.octo(), repo, { title, body, labels });
  }

  async listLabels(repo: string): Promise<string[]> {
    return issues.listLabels(await this.octo(), repo);
  }

  async createLabels(
    repo: string,
    labels: Array<{ name: string; color?: string; description?: string }>,
  ): Promise<void> {
    return issues.createLabels(await this.octo(), repo, labels);
  }

  async commentOnIssue(
    repo: string,
    number: number,
    body: string,
  ): Promise<void> {
    return issues.commentOnIssue(await this.octo(), repo, number, body);
  }

  async closeIssue(
    repo: string,
    number: number,
    reason: CloseReason = "completed",
  ): Promise<void> {
    return issues.closeIssue(await this.octo(), repo, number, reason);
  }

  async addIssueLabel(
    repo: string,
    number: number,
    label: string,
  ): Promise<void> {
    return issues.addIssueLabel(await this.octo(), repo, number, label);
  }

  async removeIssueLabel(
    repo: string,
    number: number,
    label: string,
  ): Promise<void> {
    return issues.removeIssueLabel(await this.octo(), repo, number, label);
  }

  // ── GitHubPort: repo content/branches ───────────────────────────────

  async getFileContent(
    repo: string,
    path: string,
    ref?: string,
  ): Promise<string | null> {
    return repoContent.getFileContent(await this.octo(), repo, path, ref);
  }

  async listDirectory(repo: string, path: string): Promise<string[]> {
    return repoContent.listDirectory(await this.octo(), repo, path);
  }

  async listTree(repo: string, ref?: string): Promise<string[]> {
    return repoContent.listTree(await this.octo(), repo, ref);
  }

  getDefaultBranch(repo: string): Promise<string> {
    return this.octo().then((ok) => fetchDefaultBranch(ok, repo));
  }

  async listCommitsSince(
    repo: string,
    since: string,
  ): Promise<Array<{ sha: string; files: string[] }>> {
    return repoContent.listCommitsSince(await this.octo(), repo, since);
  }

  async branchExists(repo: string, branch: string): Promise<boolean> {
    return repoContent.branchExists(await this.octo(), repo, branch);
  }

  async createBranch(
    repo: string,
    branch: string,
    base = "main",
  ): Promise<void> {
    return repoContent.createBranch(await this.octo(), repo, branch, base);
  }

  async commitFile(
    repo: string,
    branch: string,
    change: FileChange,
  ): Promise<void> {
    return repoContent.commitFile(await this.octo(), repo, branch, change);
  }

  async upsertCheckRun(repo: string, input: CheckRunInput): Promise<void> {
    return repoConfig.upsertCheckRun(await this.octo(), repo, input);
  }

  async setRepoVariable(
    repo: string,
    name: string,
    value: string,
  ): Promise<void> {
    return repoConfig.setRepoVariable(await this.octo(), repo, name, value);
  }

  async setRepoSecret(
    repo: string,
    name: string,
    value: string,
  ): Promise<void> {
    return repoConfig.setRepoSecret(await this.octo(), repo, name, value);
  }

  // ── PullRequestsPort: reads ─────────────────────────────────────────

  async list(repo: string): Promise<PullRef[]> {
    return pullsRead.list(await this.octo(), repo);
  }

  async get(repo: string, number: number): Promise<PullRef | null> {
    return pullsRead.get(await this.octo(), repo, number);
  }

  async getDiff(repo: string, number: number): Promise<string> {
    return pullsRead.getDiff(await this.octo(), repo, number);
  }

  async listCommits(repo: string, number: number): Promise<PullCommit[]> {
    return pullsRead.listCommits(await this.octo(), repo, number);
  }

  async isMerged(repo: string, number: number): Promise<boolean> {
    return pullsRead.isMerged(await this.octo(), repo, number);
  }

  async isClosed(repo: string, number: number): Promise<boolean> {
    return pullsRead.isClosed(await this.octo(), repo, number);
  }

  async getStats(repo: string, number: number): Promise<PullStats> {
    return pullsRead.getStats(await this.octo(), repo, number);
  }

  async changedFileCount(
    repo: string,
    base: string,
    head: string,
  ): Promise<number> {
    return pullsRead.changedFileCount(await this.octo(), repo, base, head);
  }

  async listFiles(repo: string, number: number): Promise<string[]> {
    return pullsRead.listFiles(await this.octo(), repo, number);
  }

  // ── PullRequestsPort: reviews/comments/CI ───────────────────────────

  async listReviews(repo: string, number: number): Promise<PullReview[]> {
    return pullsReviewReads.listReviews(await this.octo(), repo, number);
  }

  async listComments(repo: string, number: number): Promise<ReviewComment[]> {
    return pullsReviewReads.listComments(await this.octo(), repo, number);
  }

  async listReviewThreads(
    repo: string,
    number: number,
  ): Promise<ReviewThread[]> {
    return pullsReviewReads.listReviewThreads(await this.octo(), repo, number);
  }

  async listIssueComments(
    repo: string,
    number: number,
  ): Promise<IssueComment[]> {
    return pullsReviewReads.listIssueComments(await this.octo(), repo, number);
  }

  listChecks(repo: string, ref: string): Promise<CheckRun[]> {
    return this.octo().then((ok) => pullsReviewReads.checkRuns(ok, repo, ref));
  }

  async ciConclusion(repo: string, ref: string): Promise<CiConclusion> {
    return pullsReviewReads.ciConclusion(await this.octo(), repo, ref);
  }

  // ── PullRequestsPort: writes ─────────────────────────────────────────

  async comment(repo: string, number: number, body: string): Promise<void> {
    return pullsWrite.comment(await this.octo(), repo, number, body);
  }

  async review(
    repo: string,
    number: number,
    body: string,
    event: PRReviewEvent,
  ): Promise<void> {
    return pullsWrite.review(await this.octo(), repo, number, { body, event });
  }

  async createReview(
    repo: string,
    number: number,
    input: CreateReviewInput,
  ): Promise<void> {
    return pullsWrite.createReview(await this.octo(), repo, number, input);
  }

  async replyToReviewComment(
    repo: string,
    number: number,
    commentId: number,
    body: string,
  ): Promise<void> {
    return pullsWrite.replyToReviewComment(await this.octo(), repo, number, {
      commentId,
      body,
    });
  }

  async addLabel(repo: string, number: number, label: string): Promise<void> {
    return pullsWrite.addLabel(await this.octo(), repo, number, label);
  }

  async merge(
    repo: string,
    number: number,
    method: MergeMethod = "squash",
  ): Promise<void> {
    return pullsWrite.merge(await this.octo(), repo, number, method);
  }

  async open(repo: string, branch: string, draft: PullDraft): Promise<PullRef> {
    return pullsWrite.open(await this.octo(), repo, branch, draft);
  }

  async update(
    repo: string,
    number: number,
    fields: { title?: string; body?: string },
  ): Promise<void> {
    return pullsWrite.update(await this.octo(), repo, number, fields);
  }

  async markReady(repo: string, number: number): Promise<void> {
    return pullsWrite.markReady(await this.octo(), repo, number);
  }

  async resolveReviewThread(threadId: string): Promise<void> {
    return pullsWrite.resolveReviewThread(await this.octo(), threadId);
  }

  // ── auth ────────────────────────────────────────────────────────────

  /** GitHub App installation token for the git-auth helper's clone/push credential; not on GitHubPort — consumers depend on the structural shape, keeping the Project facade token-free. */
  async getInstallationToken(): Promise<string> {
    const ok = await this.octo();
    const auth = (await ok.auth({ type: "installation" })) as { token: string };

    return auth.token;
  }

  private octo(): Promise<Octokit> {
    if (!this.client) {
      this.client = buildOctokit(this.env);
    }

    return this.client;
  }
}
