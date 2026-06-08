import type { GitHubPort } from "../lib/github-port.js";

/**
 * project.repo — GitHub file access over the API, repo bound. READS need no
 * clone. The branch + single-file WRITES are also GitHub-API operations (no
 * clone) — that's the existing PR-build flow, preserved here. The clone-based
 * Workspace (Project.cache()) is the separate path for bulk local edits.
 */
export class RepoFiles {
  constructor(
    private readonly repo: string,
    private readonly github: GitHubPort,
  ) {}

  read(path: string, ref?: string): Promise<string | null> {
    return this.github.getFileContent(this.repo, path, ref);
  }

  list(path: string): Promise<string[]> {
    return this.github.listDirectory(this.repo, path);
  }

  tree(ref?: string): Promise<string[]> {
    return this.github.listTree(this.repo, ref);
  }

  defaultBranch(): Promise<string> {
    return this.github.getDefaultBranch(this.repo);
  }

  createBranch(branch: string, base?: string): Promise<void> {
    return this.github.createBranch(this.repo, branch, base);
  }

  commitFile(branch: string, path: string, content: string, message: string): Promise<void> {
    return this.github.commitFile(this.repo, branch, path, content, message);
  }
}
