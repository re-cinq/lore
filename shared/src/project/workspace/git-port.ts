/**
 * Git working-tree port — clone + writes. The GitCli adapter wraps the execSync
 * git worktree/add/commit/push idiom already in mcp-server/src/local-runner.ts.
 * This is the only place file WRITES exist; reads-for-context go over the API.
 */

export interface CloneOpts {
  ref?: string;
}

export interface GitPort {
  clone(repo: string, destDir: string, opts?: CloneOpts): Promise<void>;
  listBranches(dir: string): Promise<string[]>;
  switchBranch(dir: string, branch: string, opts?: { create?: boolean }): Promise<void>;
  readFile(dir: string, path: string): Promise<string>;
  writeFile(dir: string, path: string, content: string): Promise<void>;
  stageCommit(dir: string, message: string): Promise<{ committed: boolean }>;
  push(dir: string, branch: string): Promise<void>;
  remove(dir: string): Promise<void>;
}
