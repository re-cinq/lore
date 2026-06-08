/**
 * The GitHub port the Project facade reads through. A structural subset of
 * agent's CodePlatform (agent/src/platform.ts) so GitHubPlatform satisfies it
 * without a rewrite. Grows method-by-method as later slices triangulate the
 * surface — same philosophy as the MemoryStore seam.
 */

export type IssueState = "open" | "closed";

export interface IssueRef {
  repo: string;
  number: number;
  title: string;
  state: IssueState;
  labels: string[];
}

export interface IssueFilter {
  state?: IssueState;
  labels?: string[];
}

export interface GitHubPort {
  readonly name: string;
  listIssues(repo: string, filter?: IssueFilter): Promise<IssueRef[]>;
  getFileContent(repo: string, path: string, ref?: string): Promise<string | null>;
  listDirectory(repo: string, path: string): Promise<string[]>;
  listTree(repo: string, ref?: string): Promise<string[]>;
}
