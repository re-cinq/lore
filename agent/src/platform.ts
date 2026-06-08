/**
 * Code platform abstraction.
 *
 * Defines the operations Lore needs from a code hosting platform
 * (branches, commits, PRs, issues, repo content). GitHub is the
 * only implementation today. Adding GitLab or Bitbucket means
 * implementing this interface — no changes to worker, jobs, or
 * any other module.
 */

// ── Interfaces ───────────────────────────────────────────────────────

export interface PlatformPR {
  url: string;
  number: number;
}

export interface PlatformIssue {
  url: string;
  number: number;
}

export interface RepoFile {
  path: string;
  content: string;
}

export interface PullReview {
  id: number;
  state: string;
  body: string;
  user: string;
  submitted_at: string;
}

export interface ReviewComment {
  id: number;
  path: string;
  line: number | null;
  body: string;
  user: string;
  created_at: string;
}

export interface PullCommit {
  sha: string;
  message: string;
  date: string;
}

export type PRStatus =
  | 'draft'
  | 'open'
  | 'checks-failing'
  | 'changes-requested'
  | 'approved'
  | 'merged'
  | 'closed';

export interface PRDetails {
  number: number;
  title: string;
  state: string;
  draft: boolean;
  merged: boolean;
  mergeable: boolean | null;
  html_url: string;
  checks: Array<{ name: string; status: string; conclusion: string | null }>;
  reviews: Array<{ user: string; state: string; submitted_at: string }>;
  computed_status: PRStatus;
}

export interface CodePlatform {
  readonly name: string;

  isConfigured(): boolean;

  // ── Branches & Commits ──
  createBranch(repo: string, branch: string, base?: string): Promise<void>;
  commitFile(repo: string, branch: string, path: string, content: string, message: string): Promise<void>;

  // ── Pull Requests ──
  createPR(repo: string, branch: string, title: string, body: string, base?: string, labels?: string[]): Promise<PlatformPR>;
  getPRDiff(repo: string, prNumber: number): Promise<string>;
  listPRReviews(repo: string, prNumber: number): Promise<PullReview[]>;
  listPRComments(repo: string, prNumber: number): Promise<ReviewComment[]>;
  listPRIssueComments(repo: string, prNumber: number): Promise<{ body: string; user: string; created_at: string }[]>;
  listPRCommits(repo: string, prNumber: number): Promise<PullCommit[]>;
  commentOnPR(repo: string, prNumber: number, body: string): Promise<void>;
  addPRLabel(repo: string, prNumber: number, label: string): Promise<void>;

  // ── Issues ──
  createIssue(repo: string, title: string, body: string, labels?: string[]): Promise<PlatformIssue>;
  commentOnIssue(repo: string, issueNumber: number, body: string): Promise<void>;
  closeIssue(repo: string, issueNumber: number, reason?: "completed" | "not_planned"): Promise<void>;
  addIssueLabel(repo: string, issueNumber: number, label: string): Promise<void>;
  getIssueLabels(repo: string, issueNumber: number): Promise<string[]>;
  removeIssueLabel(repo: string, issueNumber: number, label: string): Promise<void>;

  // ── Repo Metadata ──
  getDefaultBranch(repo: string): Promise<string>;

  // ── Repo Content ──
  getFileContent(repo: string, path: string, ref?: string): Promise<string | null>;
  listDirectory(repo: string, path: string): Promise<string[]>;
  /** Recursively list every file (blob) path in the repo at `ref`
   *  (defaults to the repo's default branch). */
  listTree(repo: string, ref?: string): Promise<string[]>;
  listCommitsSince(repo: string, since: string): Promise<Array<{ sha: string; files: string[] }>>;

  // ── PR Details ──
  getPRDetails(repo: string, prNumber: number): Promise<PRDetails>;

  // ── Merge status ──
  isPRMerged(repo: string, prNumber: number): Promise<boolean>;
  isPRClosed(repo: string, prNumber: number): Promise<boolean>;
  getPRStats(repo: string, prNumber: number): Promise<{ files_changed: number; additions: number; deletions: number; comments: number; merged_at: string | null; created_at: string }>;

  // ── Repo Config ──
  setRepoVariable(repo: string, name: string, value: string): Promise<void>;
  setRepoSecret(repo: string, name: string, value: string): Promise<void>;
}

// The platform()/setPlatform singleton was retired when all call sites moved to
// the Project facade (projectFor → createProject). The CodePlatform interface +
// value types above remain for GitHubPlatform (createLabels, getInstallationToken)
// and shared types (ReviewComment) still imported directly.
