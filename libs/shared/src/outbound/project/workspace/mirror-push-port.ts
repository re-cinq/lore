export interface MirrorPushRequest {
  sourceUrl: string;
  sourceAuthArgs: string[];
  targetUrl: string;
  targetAuthArgs: string[];
  sha: string;
  tag: string;
}

export type MirrorPushOutcome =
  | { kind: "pushed"; sha: string; tag: string }
  | { kind: "already-up-to-date"; sha: string; tag: string }
  | { kind: "target-diverged"; targetHead: string }
  | { kind: "tag-at-other-sha"; tagSha: string };

/** The public repository is the source and the private one the target: its sync branch is where public commits wait for a pull request. */
export interface MirrorPullRequest {
  sourceUrl: string;
  sourceAuthArgs: string[];
  targetUrl: string;
  targetAuthArgs: string[];
  branch: string;
  /** The head of the newest merged sync pull request, to learn whether that merge brought it into the target's main. */
  mergedHead?: string;
}

export interface MirrorCommit {
  sha: string;
  subject: string;
}

export interface MirrorPulled {
  publicHead: string;
  ahead: number;
  commits: MirrorCommit[];
  /** True when `mergedHead` is a commit the target's main still lacks: that merge was a squash or a rebase. */
  mergedHeadOutsideTarget: boolean;
}

export type MirrorPullOutcome =
  | { kind: "in-sync" }
  | ({ kind: "pushed" } & MirrorPulled)
  | ({ kind: "already-pushed" } & MirrorPulled)
  | { kind: "branch-diverged"; branchHead: string };

export interface MirrorPushPort {
  push(request: MirrorPushRequest): Promise<MirrorPushOutcome>;
  /** Copies the public main to the sync branch of the private repository, fast-forward only, and never touches its default branch. */
  pullBranch(request: MirrorPullRequest): Promise<MirrorPullOutcome>;
}
