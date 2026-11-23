/* eslint-disable max-lines -- one class implementing two ports, one delegating method per port method: the length IS the port surface, and splitting the class would put half of GitHub in one file and half in another. */
import { mergedPullsTouching } from "./platform-github-pulls-touching.js";
import { searchCode } from "./platform-github-code-search.js";
import type { Octokit } from "octokit";
import type {
  BranchHistoryOptions,
  TrackerActivityOptions,
  CommitDetail,
  FileChange,
} from "./github-port.js";
import type { PullDraft } from "../pulls/pull-requests-port.js";
import { buildOctokit, installationIdFor } from "./platform-github-auth.js";
import type { GithubInstallationsRepository } from "../github-installations/github-installations-port.js";
import type { TrackedEntry } from "../../../domain/utopia/github/tracker-text.js";
import type {
  ReleaseEntry,
  TagEntry,
} from "../../../domain/utopia/github/release-text.js";
import type {
  GitHubPort,
  GitHubReleasePort,
  ReleaseEdit,
  ReleaseInput,
  ReleaseRecord,
  IssueRef,
  IssueFilter,
  IssueState,
  CloseReason,
  IssueEdit,
  CheckRunInput,
  CodeMatch,
  LinkedPullRequest,
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
  PullFileChange,
  BranchRule,
  FileChangeSummary,
  BranchUpdate,
  Mergeability,
} from "../pulls/pull-requests-port.js";
import { defaultBranch as fetchDefaultBranch } from "./platform-github-support.js";
import * as issues from "./platform-github-issues.js";
import * as issueLinks from "./platform-github-issue-links.js";
import * as repoContent from "./platform-github-repo-content.js";
import { listBranchHistory } from "./platform-github-history.js";
import { listTrackerActivity } from "./platform-github-tracker.js";
import * as releases from "./platform-github-releases.js";
import * as repoConfig from "./platform-github-repo-config.js";
import * as pullsRead from "./platform-github-pulls-read.js";
import * as branchRule from "./platform-github-branch-rule.js";
import * as pullsReviewReads from "./platform-github-pulls-review-reads.js";
import * as pullsWrite from "./platform-github-pulls-write.js";
import * as actionsReads from "./platform-github-actions.js";

export type { IssueState, CloseReason };

/** One GitHub adapter satisfying BOTH GitHubPort and PullRequestsPort (auth relocated from mcp-server/github-client.ts, REST from agent/github.ts); octokit is imported lazily so the module loads where it's absent. Method bodies delegate to the sibling `platform-github-*` modules, grouped by job (issues, repo content/config, PR reads, PR review reads, PR writes). */
export class PlatformGitHub
  implements GitHubPort, GitHubReleasePort, PullRequestsPort
{
  readonly name = "github";
  private readonly clients = new Map<string, Promise<Octokit>>();

  constructor(
    private readonly env: NodeJS.ProcessEnv = process.env,
    private readonly installations?: GithubInstallationsRepository,
    private readonly defaultRepo?: string,
  ) {}

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
        (!!GITHUB_APP_INSTALLATION_ID || !!this.installations)) ||
      !!GITHUB_TOKEN
    );
  }

  // ── GitHubPort: issues ────────────────────────────────────────────────

  async listIssues(repo: string, filter?: IssueFilter): Promise<IssueRef[]> {
    return issues.listIssues(await this.octo(repo), repo, filter);
  }

  async getIssue(repo: string, number: number): Promise<IssueRef | null> {
    return issues.getIssue(await this.octo(repo), repo, number);
  }

  async getIssueLabels(repo: string, number: number): Promise<string[]> {
    return issues.getIssueLabels(await this.octo(repo), repo, number);
  }

  async listLinkedPullRequests(
    repo: string,
    number: number,
  ): Promise<LinkedPullRequest[]> {
    return issueLinks.listLinkedPullRequests(
      await this.octo(repo),
      repo,
      number,
    );
  }

  async listOpenBlockers(repo: string, number: number): Promise<number[]> {
    return issues.listOpenBlockers(await this.octo(repo), repo, number);
  }

  async createIssue(
    repo: string,
    title: string,
    body: string,
    labels: string[] = ["lore-managed"],
  ): Promise<IssueRef> {
    return issues.createIssue(await this.octo(repo), repo, {
      title,
      body,
      labels,
    });
  }

  async addSubIssue(
    repo: string,
    parentNumber: number,
    childNumber: number,
  ): Promise<void> {
    return issueLinks.addSubIssue(
      await this.octo(repo),
      repo,
      parentNumber,
      childNumber,
    );
  }

  async updateIssue(
    repo: string,
    number: number,
    edit: IssueEdit,
  ): Promise<void> {
    return issueLinks.updateIssue(await this.octo(repo), repo, number, edit);
  }

  async listLabels(repo: string): Promise<string[]> {
    return issues.listLabels(await this.octo(repo), repo);
  }

  async createLabels(
    repo: string,
    labels: Array<{ name: string; color?: string; description?: string }>,
  ): Promise<void> {
    return issues.createLabels(await this.octo(repo), repo, labels);
  }

  async commentOnIssue(
    repo: string,
    number: number,
    body: string,
  ): Promise<void> {
    return issues.commentOnIssue(await this.octo(repo), repo, number, body);
  }

  async updateIssueComment(
    repo: string,
    id: number,
    body: string,
  ): Promise<void> {
    return issues.updateIssueComment(await this.octo(repo), repo, id, body);
  }

  async closeIssue(
    repo: string,
    number: number,
    reason: CloseReason = "completed",
  ): Promise<void> {
    return issues.closeIssue(await this.octo(repo), repo, number, reason);
  }

  async addIssueLabel(
    repo: string,
    number: number,
    label: string,
  ): Promise<void> {
    return issues.addIssueLabel(await this.octo(repo), repo, number, label);
  }

  async removeIssueLabel(
    repo: string,
    number: number,
    label: string,
  ): Promise<void> {
    return issues.removeIssueLabel(await this.octo(repo), repo, number, label);
  }

  // ── GitHubPort: repo content/branches ───────────────────────────────

  async getFileContent(
    repo: string,
    path: string,
    ref?: string,
  ): Promise<string | null> {
    return repoContent.getFileContent(await this.octo(repo), repo, path, ref);
  }

  async listDirectory(repo: string, path: string): Promise<string[]> {
    return repoContent.listDirectory(await this.octo(repo), repo, path);
  }

  async listTree(repo: string, ref?: string): Promise<string[]> {
    return repoContent.listTree(await this.octo(repo), repo, ref);
  }

  getDefaultBranch(repo: string): Promise<string> {
    return this.octo(repo).then((ok) => fetchDefaultBranch(ok, repo));
  }

  async branchHeadSha(repo: string, branch: string): Promise<string> {
    const { git } = (await this.octo(repo)).rest;

    return repoContent.branchHeadSha(git, repo, branch);
  }

  async commitEmailOf(repo: string, login: string): Promise<string | null> {
    return repoContent.commitEmailOf(await this.octo(repo), repo, login);
  }

  async listBranchHistory(
    repo: string,
    branch: string,
    opts: BranchHistoryOptions,
  ): Promise<CommitDetail[]> {
    return listBranchHistory(await this.octo(repo), repo, branch, opts);
  }

  async listTrackerActivity(
    repo: string,
    opts: TrackerActivityOptions,
  ): Promise<TrackedEntry[]> {
    return listTrackerActivity(await this.octo(repo), repo, opts);
  }

  async listReleases(repo: string): Promise<ReleaseEntry[]> {
    return releases.listReleases(await this.octo(repo), repo);
  }

  async listTags(repo: string): Promise<TagEntry[]> {
    return releases.listTags(await this.octo(repo), repo);
  }

  async createTagRef(repo: string, tag: string, sha: string): Promise<void> {
    return releases.createTagRef(await this.octo(repo), repo, tag, sha);
  }

  async createRelease(
    repo: string,
    input: ReleaseInput,
  ): Promise<ReleaseRecord> {
    return releases.createRelease(await this.octo(repo), repo, input);
  }

  async releaseByTag(repo: string, tag: string): Promise<ReleaseRecord | null> {
    return releases.releaseByTag(await this.octo(repo), repo, tag);
  }

  async updateRelease(
    repo: string,
    id: number,
    edit: ReleaseEdit,
  ): Promise<ReleaseRecord> {
    return releases.updateRelease(await this.octo(repo), repo, id, edit);
  }

  async repoVariable(repo: string, name: string): Promise<string | null> {
    return releases.repoVariable(await this.octo(repo), repo, name);
  }

  async branchExists(repo: string, branch: string): Promise<boolean> {
    return repoContent.branchExists(await this.octo(repo), repo, branch);
  }

  async branchMerged(
    repo: string,
    branch: string,
  ): Promise<boolean | undefined> {
    return repoContent.branchMerged(await this.octo(repo), repo, branch);
  }

  async branchBehindBy(
    repo: string,
    branch: string,
  ): Promise<number | undefined> {
    return repoContent.branchBehindBy(await this.octo(repo), repo, branch);
  }

  async createBranch(
    repo: string,
    branch: string,
    base = "main",
  ): Promise<void> {
    return repoContent.createBranch(await this.octo(repo), repo, branch, base);
  }

  async commitFile(
    repo: string,
    branch: string,
    change: FileChange,
  ): Promise<void> {
    return repoContent.commitFile(await this.octo(repo), repo, branch, change);
  }

  async deleteFile(
    repo: string,
    branch: string,
    change: Omit<FileChange, "content">,
  ): Promise<boolean> {
    return repoContent.deleteFile(await this.octo(repo), repo, branch, change);
  }

  async mergedPullsTouching(repo: string, path: string): Promise<PullRef[]> {
    return mergedPullsTouching(await this.octo(repo), repo, path);
  }

  async searchCode(repo: string, term: string): Promise<CodeMatch[]> {
    return searchCode(await this.octo(repo), repo, term);
  }

  async upsertCheckRun(repo: string, input: CheckRunInput): Promise<void> {
    return repoConfig.upsertCheckRun(await this.octo(repo), repo, input);
  }

  async setRepoVariable(
    repo: string,
    name: string,
    value: string,
  ): Promise<void> {
    return repoConfig.setRepoVariable(await this.octo(repo), repo, name, value);
  }

  async setRepoSecret(
    repo: string,
    name: string,
    value: string,
  ): Promise<void> {
    return repoConfig.setRepoSecret(await this.octo(repo), repo, name, value);
  }

  async workflowState(
    repo: string,
    file: string,
  ): Promise<repoConfig.WorkflowState> {
    return repoConfig.workflowState(await this.octo(repo), repo, file);
  }

  async enableWorkflow(repo: string, file: string): Promise<void> {
    return repoConfig.enableWorkflow(await this.octo(repo), repo, file);
  }

  async dispatchWorkflow(
    repo: string,
    file: string,
    ref: string,
  ): Promise<void> {
    return repoConfig.dispatchWorkflow(await this.octo(repo), repo, file, ref);
  }

  // ── PullRequestsPort: reads ─────────────────────────────────────────

  async list(repo: string): Promise<PullRef[]> {
    return pullsRead.list(await this.octo(repo), repo);
  }

  async listByHead(repo: string, branch: string): Promise<PullRef[]> {
    return pullsRead.listByHead(await this.octo(repo), repo, branch);
  }

  async listMergedSince(repo: string, since: string): Promise<PullRef[]> {
    return pullsRead.listMergedSince(await this.octo(repo), repo, since);
  }

  async get(repo: string, number: number): Promise<PullRef | null> {
    return pullsRead.get(await this.octo(repo), repo, number);
  }

  async getDiff(repo: string, number: number): Promise<string> {
    return pullsRead.getDiff(await this.octo(repo), repo, number);
  }

  async listCommits(repo: string, number: number): Promise<PullCommit[]> {
    return pullsRead.listCommits(await this.octo(repo), repo, number);
  }

  async isMerged(repo: string, number: number): Promise<boolean> {
    return pullsRead.isMerged(await this.octo(repo), repo, number);
  }

  async isClosed(repo: string, number: number): Promise<boolean> {
    return pullsRead.isClosed(await this.octo(repo), repo, number);
  }

  async getStats(repo: string, number: number): Promise<PullStats> {
    return pullsRead.getStats(await this.octo(repo), repo, number);
  }

  async getBranchRule(repo: string, branch: string): Promise<BranchRule> {
    return branchRule.getBranchRule(await this.octo(repo), repo, branch);
  }

  async getMergeability(repo: string, number: number): Promise<Mergeability> {
    return branchRule.getMergeability(await this.octo(repo), repo, number);
  }

  async updateBranch(
    repo: string,
    number: number,
    expectedHeadSha: string,
  ): Promise<BranchUpdate> {
    return pullsWrite.updateBranch(
      await this.octo(repo),
      repo,
      number,
      expectedHeadSha,
    );
  }

  async changedFileCount(
    repo: string,
    base: string,
    head: string,
  ): Promise<number> {
    return pullsRead.changedFileCount(await this.octo(repo), repo, base, head);
  }

  async listFiles(repo: string, number: number): Promise<string[]> {
    return pullsRead.listFiles(await this.octo(repo), repo, number);
  }

  async getChangedFiles(repo: string, number: number): Promise<string[]> {
    return pullsRead.getChangedFiles(await this.octo(repo), repo, number);
  }

  async listFileChanges(
    repo: string,
    number: number,
  ): Promise<PullFileChange[]> {
    return pullsRead.listFileChanges(await this.octo(repo), repo, number);
  }

  async netChange(
    repo: string,
    base: string,
    head: string,
  ): Promise<FileChangeSummary[] | null> {
    return pullsRead.netChange(await this.octo(repo), repo, base, head);
  }

  // ── PullRequestsPort: reviews/comments/CI ───────────────────────────

  async listReviews(repo: string, number: number): Promise<PullReview[]> {
    return pullsReviewReads.listReviews(await this.octo(repo), repo, number);
  }

  async listComments(repo: string, number: number): Promise<ReviewComment[]> {
    return pullsReviewReads.listComments(await this.octo(repo), repo, number);
  }

  async listReviewThreads(
    repo: string,
    number: number,
  ): Promise<ReviewThread[]> {
    return pullsReviewReads.listReviewThreads(
      await this.octo(repo),
      repo,
      number,
    );
  }

  async listIssueComments(
    repo: string,
    number: number,
  ): Promise<IssueComment[]> {
    return pullsReviewReads.listIssueComments(
      await this.octo(repo),
      repo,
      number,
    );
  }

  listChecks(repo: string, ref: string): Promise<CheckRun[]> {
    return this.octo(repo).then((ok) =>
      pullsReviewReads.checkRuns(ok, repo, ref),
    );
  }

  async failedJob(repo: string, jobId: number) {
    return actionsReads.failedJob(await this.octo(repo), repo, jobId);
  }

  async jobLog(repo: string, jobId: number): Promise<string | null> {
    return actionsReads.jobLog(await this.octo(repo), repo, jobId);
  }

  async listBranchCommits(
    repo: string,
    branch: string,
    limit: number,
  ): Promise<PullCommit[]> {
    return pullsRead.listBranchCommits(
      await this.octo(repo),
      repo,
      branch,
      limit,
    );
  }

  async ciConclusion(repo: string, ref: string): Promise<CiConclusion> {
    return pullsReviewReads.ciConclusion(await this.octo(repo), repo, ref);
  }

  // ── PullRequestsPort: writes ─────────────────────────────────────────

  async comment(repo: string, number: number, body: string): Promise<void> {
    return pullsWrite.comment(await this.octo(repo), repo, number, body);
  }

  async review(
    repo: string,
    number: number,
    body: string,
    event: PRReviewEvent,
  ): Promise<void> {
    return pullsWrite.review(await this.octo(repo), repo, number, {
      body,
      event,
    });
  }

  async createReview(
    repo: string,
    number: number,
    input: CreateReviewInput,
  ): Promise<void> {
    return pullsWrite.createReview(await this.octo(repo), repo, number, input);
  }

  async replyToReviewComment(
    repo: string,
    number: number,
    commentId: number,
    body: string,
  ): Promise<void> {
    return pullsWrite.replyToReviewComment(
      await this.octo(repo),
      repo,
      number,
      {
        commentId,
        body,
      },
    );
  }

  async addLabel(repo: string, number: number, label: string): Promise<void> {
    return pullsWrite.addLabel(await this.octo(repo), repo, number, label);
  }

  async merge(
    repo: string,
    number: number,
    method: MergeMethod = "squash",
  ): Promise<void> {
    return pullsWrite.merge(await this.octo(repo), repo, number, method);
  }

  async enablePullRequestAutoMerge(
    prId: string,
    mergeMethod?: MergeMethod,
    repo?: string,
  ): Promise<void> {
    return pullsWrite.enablePullRequestAutoMerge(
      await this.octo(repo),
      prId,
      mergeMethod,
    );
  }

  // eslint-disable-next-line re-lint/no-negative-names
  async disablePullRequestAutoMerge(
    prId: string,
    repo?: string,
  ): Promise<void> {
    return pullsWrite.disablePullRequestAutoMerge(await this.octo(repo), prId);
  }

  async open(repo: string, branch: string, draft: PullDraft): Promise<PullRef> {
    return pullsWrite.open(await this.octo(repo), repo, branch, draft);
  }

  async update(
    repo: string,
    number: number,
    fields: { title?: string; body?: string },
  ): Promise<void> {
    return pullsWrite.update(await this.octo(repo), repo, number, fields);
  }

  async markReady(repo: string, number: number): Promise<void> {
    return pullsWrite.markReady(await this.octo(repo), repo, number);
  }

  async close(repo: string, number: number): Promise<void> {
    return pullsWrite.close(await this.octo(repo), repo, number);
  }

  async resolveReviewThread(threadId: string, repo?: string): Promise<void> {
    return pullsWrite.resolveReviewThread(await this.octo(repo), threadId);
  }

  // ── auth ────────────────────────────────────────────────────────────

  /** GitHub App installation token for the git-auth helper's clone/push credential; not on GitHubPort — consumers depend on the structural shape, keeping the Project facade token-free. Always FRESH (octokit caches tokens up to 59 minutes, so a cached one can die mid-run) and, given a repo, scoped to that one repo. Given `permissions`, the token carries only those, not every permission the App holds. */
  async getInstallationToken(
    repo?: string,
    permissions?: Record<string, "read" | "write">,
  ): Promise<string> {
    const ok = await this.octo(repo);
    const auth = (await ok.auth({
      type: "installation",
      refresh: true,
      ...(repo ? { repositoryNames: [repo.split("/")[1]] } : {}),
      ...(permissions ? { permissions } : {}),
    })) as { token: string };

    return auth.token;
  }

  /** The client for the installation of the repo's owner (the env installation when none is recorded or no repo is given), one per installation id. */
  private async octo(
    repo: string | undefined = this.defaultRepo,
  ): Promise<Octokit> {
    const installationId = await installationIdFor(
      this.installations,
      repo,
      this.env,
    );
    const key = installationId ?? "";
    let client = this.clients.get(key);

    if (!client) {
      client = buildOctokit(this.env, {}, installationId);
      this.clients.set(key, client);
      client.catch(() => this.clients.delete(key));
    }

    return client;
  }
}
