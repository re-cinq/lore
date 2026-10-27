import type { PullRef } from "../pulls/pull-requests-port.js";
import type {
  BranchHistoryOptions,
  CheckRunInput,
  CommitDetail,
  GitHubPort,
  TrackerActivityOptions,
} from "../lib/github-port.js";
import type { TrackedEntry } from "../../../domain/utopia/github/tracker-text.js";
import type {
  ReleaseEntry,
  TagEntry,
} from "../../../domain/utopia/github/release-text.js";

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

  branchHistory(
    branch: string,
    opts: BranchHistoryOptions,
  ): Promise<CommitDetail[]> {
    return this.github.listBranchHistory(this.repo, branch, opts);
  }

  trackerActivity(opts: TrackerActivityOptions): Promise<TrackedEntry[]> {
    return this.github.listTrackerActivity(this.repo, opts);
  }

  releases(): Promise<ReleaseEntry[]> {
    return this.github.listReleases(this.repo);
  }

  tags(): Promise<TagEntry[]> {
    return this.github.listTags(this.repo);
  }

  defaultBranch(): Promise<string> {
    return this.github.getDefaultBranch(this.repo);
  }

  headSha(branch: string): Promise<string> {
    return this.github.branchHeadSha(this.repo, branch);
  }

  /** The login's newest commit email here; null when unknown, including on an adapter that cannot say. */
  async commitEmailOf(login: string): Promise<string | null> {
    return (await this.github.commitEmailOf?.(this.repo, login)) ?? null;
  }

  /** True/false when adapter answers; undefined means "don't modify branch". */
  branchExists(branch: string): Promise<boolean> | undefined {
    return this.github.branchExists?.(this.repo, branch);
  }

  branchMerged(branch: string): Promise<boolean | undefined> {
    return (
      this.github.branchMerged?.(this.repo, branch) ??
      Promise.resolve(undefined)
    );
  }

  branchBehindBy(branch: string): Promise<number | undefined> {
    return (
      this.github.branchBehindBy?.(this.repo, branch) ??
      Promise.resolve(undefined)
    );
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

  /** Deletes one file from the branch in its own commit; false when it has none, or the adapter cannot. */
  deleteFile(branch: string, path: string, message: string): Promise<boolean> {
    return (
      this.github.deleteFile?.(this.repo, branch, { path, message }) ??
      NOTHING_DELETED
    );
  }

  /** The merged pull requests that touched `path`; none when the adapter cannot say. */
  async mergedPullsTouching(path: string): Promise<PullRef[]> {
    return (await this.github.mergedPullsTouching?.(this.repo, path)) ?? [];
  }

  upsertCheckRun(input: CheckRunInput): Promise<void> {
    return this.github.upsertCheckRun(this.repo, input);
  }
}

const NOTHING_DELETED = (async () => false)();
