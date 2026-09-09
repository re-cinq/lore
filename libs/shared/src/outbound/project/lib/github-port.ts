/** GitHub port: structural subset of agent's CodePlatform. */

export type IssueState = "open" | "closed";
export type CloseReason = "completed" | "not_planned";

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
}

export interface IssueFilter {
  state?: IssueState;
  labels?: string[];
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
  listCommitsSince(
    repo: string,
    since: string,
  ): Promise<Array<{ sha: string; files: string[] }>>;
  getIssueLabels(repo: string, number: number): Promise<string[]>;
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
  commentOnIssue(repo: string, number: number, body: string): Promise<void>;
  closeIssue(repo: string, number: number, reason?: CloseReason): Promise<void>;
  addIssueLabel(repo: string, number: number, label: string): Promise<void>;
  removeIssueLabel(repo: string, number: number, label: string): Promise<void>;
  // API writes (no clone) — branch + single-file commit
  /** True when branch exists (octokit only; caller must not guess). */
  branchExists?(repo: string, branch: string): Promise<boolean>;
  createBranch(repo: string, branch: string, base?: string): Promise<void>;
  commitFile(repo: string, branch: string, change: FileChange): Promise<void>;
  /** Create or update a check run for `input.headSha`, keyed by check name. */
  upsertCheckRun(repo: string, input: CheckRunInput): Promise<void>;
}
