/**
 * The GitHub port the Project facade reads through. A structural subset of
 * agent's CodePlatform (agent/src/platform.ts) so GitHubPlatform satisfies it
 * without a rewrite. Grows method-by-method as later slices triangulate the
 * surface — same philosophy as the MemoryStore seam.
 */

export type IssueState = "open" | "closed";
export type CloseReason = "completed" | "not_planned";

export interface IssueRef {
  repo: string;
  number: number;
  title: string;
  state: IssueState;
  labels: string[];
  url?: string;
}

export interface IssueFilter {
  state?: IssueState;
  labels?: string[];
}

export type CheckStatus = "queued" | "in_progress" | "completed";
export type CheckConclusion = "success" | "neutral" | "failure" | "cancelled";

/** A GitHub check run upsert — keyed by `(headSha, name)`, so re-publishing a
 *  line's state updates the same check rather than stacking new ones. */
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
  /** Every label the repo defines. The `issues` station checks the labels an agent
   *  chose against this: GitHub's create-issue silently CREATES an unknown label, so
   *  an invented one would quietly join the taxonomy instead of failing. */
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
  /** True when the branch already exists on the remote. Optional: only the octokit
   *  adapter implements it, and a caller that cannot ask MUST NOT guess — see
   *  createBranch, which force-resets an existing branch. */
  branchExists?(repo: string, branch: string): Promise<boolean>;
  createBranch(repo: string, branch: string, base?: string): Promise<void>;
  commitFile(
    repo: string,
    branch: string,
    path: string,
    content: string,
    message: string,
  ): Promise<void>;
  /** Create or update a check run for `input.headSha`, keyed by check name. */
  upsertCheckRun(repo: string, input: CheckRunInput): Promise<void>;
}
