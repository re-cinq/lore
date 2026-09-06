/** Git working-tree port; only place file writes exist (reads go over API). */

export interface CloneOpts {
  ref?: string;
}

export interface GitPort {
  clone(repo: string, destDir: string, opts?: CloneOpts): Promise<void>;
  /** Cache-aware clone: clone into `destDir` if absent, else `fetch` + checkout the ref (reuse). */
  ensureClone(repo: string, destDir: string, opts?: CloneOpts): Promise<void>;
  /** Pin `dir` to `branch` (and `commit` when given). Refuses to switch a dirty working tree. */
  ensureCheckout(dir: string, branch?: string, commit?: string): Promise<void>;
  listBranches(dir: string): Promise<string[]>;
  switchBranch(
    dir: string,
    branch: string,
    opts?: { create?: boolean },
  ): Promise<void>;
  readFile(dir: string, path: string): Promise<string>;
  writeFile(dir: string, path: string, content: string): Promise<void>;
  stageCommit(dir: string, message: string): Promise<{ committed: boolean }>;
  push(dir: string, branch: string): Promise<void>;
  remove(dir: string): Promise<void>;
}
