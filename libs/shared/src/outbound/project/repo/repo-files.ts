import type { CheckRunInput, GitHubPort } from "../lib/github-port.js";

/** GitHub file access via API (no clone required); use Workspace for bulk edits. */
export class RepoFiles {
  constructor(
    private readonly repo: string,
    private readonly github: GitHubPort,
  ) {}

  isConfigured(): boolean {
    return this.github.isConfigured();
  }

  read(path: string, ref?: string): Promise<string | null> {
    return this.github.getFileContent(this.repo, path, ref);
  }

  list(path: string): Promise<string[]> {
    return this.github.listDirectory(this.repo, path);
  }

  tree(ref?: string): Promise<string[]> {
    return this.github.listTree(this.repo, ref);
  }

  listCommitsSince(
    since: string,
  ): Promise<Array<{ sha: string; files: string[] }>> {
    return this.github.listCommitsSince(this.repo, since);
  }

  defaultBranch(): Promise<string> {
    return this.github.getDefaultBranch(this.repo);
  }

  /** True/false when adapter answers; undefined means "don't modify branch". */
  branchExists(branch: string): Promise<boolean> | undefined {
    return this.github.branchExists?.(this.repo, branch);
  }

  createBranch(branch: string, base?: string): Promise<void> {
    return this.github.createBranch(this.repo, branch, base);
  }

  commitFile(
    branch: string,
    path: string,
    content: string,
    message: string,
  ): Promise<void> {
    return this.github.commitFile(this.repo, branch, {
      path,
      content,
      message,
    });
  }

  upsertCheckRun(input: CheckRunInput): Promise<void> {
    return this.github.upsertCheckRun(this.repo, input);
  }
}
