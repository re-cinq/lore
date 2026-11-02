import type { IssueComment, PullRef } from "../pulls/pull-requests-port.js";
import type { TrackedEntry } from "../../../domain/utopia/github/tracker-text.js";
import type {
  ReleaseEntry,
  TagEntry,
} from "../../../domain/utopia/github/release-text.js";
/** GitHub port: structural subset of agent's CodePlatform. */

export type IssueState = "open" | "closed";
export type CloseReason = "completed" | "not_planned";

/** What an issue update rewrites; a field left out stays as it is. */
export interface LinkedPullRequest {
  number: number;
  title: string;
  state: "open" | "closed";
  merged: boolean;
  url: string;
}

export interface IssueEdit {
  title?: string;
  body?: string;
}

export interface IssueRef {
  repo: string;
  number: number;
  title: string;
  state: IssueState;
  labels: string[];
  url?: string;
  /** ISO timestamp (backlog picker tie-break; octokit adapter only). */
  createdAt?: string;
  /** Issue body (octokit adapter only; GitHub returns null if empty). */
  body?: string;
  /** How many blocked-by links the issue carries, open or closed (octokit list read only; absent when none). */
  blockedByCount?: number;
  /** How many open issues this issue blocks (octokit list read only; absent when none). */
  unblocksCount?: number;
  /** Assignee logins (octokit adapter only; empty when nobody is assigned). */
  assignees?: string[];
  /** ISO close time (octokit adapter only; absent while open). */
  closedAt?: string;
}

export interface IssueFilter {
  state?: IssueState;
  labels?: string[];
  /** ISO cutoff: only issues updated at or after it; with `state: "closed"` also only those closed at or after it. */
  since?: string;
}

export type CheckStatus = "queued" | "in_progress" | "completed";
export type CheckConclusion = "success" | "neutral" | "failure" | "cancelled";

/** GitHub check run upsert keyed by (headSha, name). */
export interface CheckRunInput {
  headSha: string;
  name: string;
  status: CheckStatus;
  /** Required by GitHub when `status === "completed"`. */
  conclusion?: CheckConclusion;
  title: string;
  summary: string;
  detailsUrl?: string;
}

/** One file written in one commit. */
export interface FileChange {
  path: string;
  content: string;
  message: string;
}

export interface BranchHistoryOptions {
  /** The sha the walk stops at, exclusive; absent, the walk takes the newest `limit` commits. */
  until?: string;
  /** At most this many commits, the newest ones. */
  limit: number;
}

export interface TrackerActivityOptions {
  /** RFC 3339; only what was updated at or after it. Absent, everything. */
  since?: string;
  /** At most this many, the oldest updates first. */
  limit: number;
}

/** One commit as GitHub tells it: the first line of its message is the subject, the rest the body. */
export interface CommitDetail {
  sha: string;
  parents: string[];
  subject: string;
  body: string;
  author: string;
  authoredAt: string;
  /** The paths the commit added, modified, renamed or deleted. */
  files: string[];
}

export interface GitHubPort {
  readonly name: string;
  isConfigured(): boolean;
  // reads
  listIssues(repo: string, filter?: IssueFilter): Promise<IssueRef[]>;
  getIssue(repo: string, number: number): Promise<IssueRef | null>;
  getFileContent(
    repo: string,
    path: string,
    ref?: string,
  ): Promise<string | null>;
  listDirectory(repo: string, path: string): Promise<string[]>;
  listTree(repo: string, ref?: string): Promise<string[]>;
  getDefaultBranch(repo: string): Promise<string>;
  branchHeadSha(repo: string, branch: string): Promise<string>;
  /** The author email of the login's newest commit in the repo, or null when it has none or hides its email behind GitHub's noreply address (the daily digest's Slack match). */
  commitEmailOf?(repo: string, login: string): Promise<string | null>;
  /** The newest `limit` commits of the branch above `until` (the whole branch without it), oldest-first. */
  listBranchHistory(
    repo: string,
    branch: string,
    opts: BranchHistoryOptions,
  ): Promise<CommitDetail[]>;
  /** The repo's issues and pull requests updated since `since`, oldest update first, at most `limit`: a cursor-driven walk resumes where the last one stopped. */
  listTrackerActivity(
    repo: string,
    opts: TrackerActivityOptions,
  ): Promise<TrackedEntry[]>;
  /** The repo's published releases, drafts left out. */
  listReleases(repo: string): Promise<ReleaseEntry[]>;
  /** Every tag of the repo with the commit it points to. */
  listTags(repo: string): Promise<TagEntry[]>;
  getIssueLabels(repo: string, number: number): Promise<string[]>;
  /** Numbers of the still-open issues linked as blocking this one. */
  listOpenBlockers(repo: string, number: number): Promise<number[]>;
  // issue writes
  createIssue(
    repo: string,
    title: string,
    body: string,
    labels?: string[],
  ): Promise<IssueRef>;
  /** List every label the repo defines (GitHub silently creates unknown ones). */
  listLabels(repo: string): Promise<string[]>;
  /** Ensure a set of repo labels exists (create-or-ignore-existing) — onboarding. */
  createLabels(
    repo: string,
    labels: Array<{ name: string; color?: string; description?: string }>,
  ): Promise<void>;
  /** Makes `childNumber` a native sub-issue of `parentNumber`. */
  addSubIssue(
    repo: string,
    parentNumber: number,
    childNumber: number,
  ): Promise<void>;
  updateIssue(repo: string, number: number, edit: IssueEdit): Promise<void>;
  commentOnIssue(repo: string, number: number, body: string): Promise<void>;
  listIssueComments(repo: string, number: number): Promise<IssueComment[]>;
  /** Pull requests that mention the issue, read from its timeline's cross-references. */
  listLinkedPullRequests(
    repo: string,
    number: number,
  ): Promise<LinkedPullRequest[]>;
  updateIssueComment(repo: string, id: number, body: string): Promise<void>;
  closeIssue(repo: string, number: number, reason?: CloseReason): Promise<void>;
  addIssueLabel(repo: string, number: number, label: string): Promise<void>;
  removeIssueLabel(repo: string, number: number, label: string): Promise<void>;
  // API writes (no clone) — branch + single-file commit
  /** True when branch exists (octokit only; caller must not guess). */
  branchExists?(repo: string, branch: string): Promise<boolean>;
  /** True when the branch head is already an ancestor of the base branch — every commit is on main, a resumed run can push nothing new. `undefined` when the adapter cannot say. */
  branchMerged?(repo: string, branch: string): Promise<boolean | undefined>;
  /** How many commits of the default branch the branch lacks. `undefined` when the adapter cannot say. */
  branchBehindBy?(repo: string, branch: string): Promise<number | undefined>;
  createBranch(repo: string, branch: string, base?: string): Promise<void>;
  commitFile(repo: string, branch: string, change: FileChange): Promise<void>;
  /** Deletes one file from the branch in its own commit; false when the branch has no such file (octokit only). */
  deleteFile?(
    repo: string,
    branch: string,
    change: Omit<FileChange, "content">,
  ): Promise<boolean>;
  /** The merged pull requests behind the newest default-branch commits that touched `path` (octokit only). */
  mergedPullsTouching?(repo: string, path: string): Promise<PullRef[]>;
  /** Create or update a check run for `input.headSha`, keyed by check name. */
  upsertCheckRun(repo: string, input: CheckRunInput): Promise<void>;
}
