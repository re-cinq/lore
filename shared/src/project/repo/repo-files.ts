import type { GitHubPort } from "../lib/github-port.js";

/**
 * project.repo — read-only file access over the GitHub API (no clone). Writes
 * live on the Workspace returned by Project.cache(); reads-for-context are here.
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
}
