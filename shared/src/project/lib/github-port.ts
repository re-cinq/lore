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

export interface GitHubPort {
  readonly name: string;
  isConfigured(): boolean;
  // reads
  listIssues(repo: string, filter?: IssueFilter): Promise<IssueRef[]>;
  getIssue(repo: string, number: number): Promise<IssueRef | null>;
  getFileContent(repo: string, path: string, ref?: string): Promise<string | null>;
  listDirectory(repo: string, path: string): Promise<string[]>;
  listTree(repo: string, ref?: string): Promise<string[]>;
  getDefaultBranch(repo: string): Promise<string>;
  listCommitsSince(repo: string, since: string): Promise<Array<{ sha: string; files: string[] }>>;
  getIssueLabels(repo: string, number: number): Promise<string[]>;
  // issue writes
  createIssue(repo: string, title: string, body: string, labels?: string[]): Promise<IssueRef>;
  commentOnIssue(repo: string, number: number, body: string): Promise<void>;
  closeIssue(repo: string, number: number, reason?: CloseReason): Promise<void>;
  addIssueLabel(repo: string, number: number, label: string): Promise<void>;
  removeIssueLabel(repo: string, number: number, label: string): Promise<void>;
  // API writes (no clone) — branch + single-file commit
  createBranch(repo: string, branch: string, base?: string): Promise<void>;
  commitFile(repo: string, branch: string, path: string, content: string, message: string): Promise<void>;
}
