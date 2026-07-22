/**
 * The no-clone PR lifecycle port. Consumed by auto-merge + the code-review
 * choreography, which operate purely over the API and never clone.
 * lib/platform-github implements this alongside GitHubPort.
 */

export type PRReviewEvent = "APPROVE" | "REQUEST_CHANGES" | "COMMENT";

/** One inline comment in a review — rendered from a structured finding. */
export interface ReviewCommentInput {
  path: string;
  line: number;
  side?: "LEFT" | "RIGHT";
  body: string;
}

/** A single review carrying a body + an array of inline comments (reviews API). */
export interface CreateReviewInput {
  event: PRReviewEvent;
  body: string;
  comments: ReviewCommentInput[];
}
export type MergeMethod = "squash" | "merge" | "rebase";

/** Aggregate GitHub Actions conclusion for a ref: the deterministic gate (ADR-031 D3).
 *  `none` = no checks configured. */
export type CiConclusion = "success" | "failure" | "pending" | "none";

export interface PullRef {
  repo: string;
  number: number;
  title: string;
  branch: string;
  state: "open" | "closed" | "merged";
  labels: string[];
  url: string;
  /** PR author login (`<slug>[bot]` for App-authored PRs). Absent on legacy doubles. */
  author?: string;
  /** Draft flag — the code-review gate skips drafts. Absent on legacy doubles. */
  draft?: boolean;
  /** Head commit sha — the PR-check publisher attaches the check to it. Absent on legacy doubles. */
  headSha?: string;
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

export interface IssueComment {
  body: string;
  user: string;
  created_at: string;
}

export interface PullCommit {
  sha: string;
  message: string;
  date: string;
}

/** A raw GitHub Actions check run — the policy predicate lives in the caller. */
export interface CheckRun {
  name: string;
  status: string;
  conclusion: string | null;
}

export interface PullStats {
  files_changed: number;
  additions: number;
  deletions: number;
  comments: number;
  merged_at: string | null;
  created_at: string;
}

export interface PullRequestsPort {
  list(repo: string): Promise<PullRef[]>;
  get(repo: string, number: number): Promise<PullRef | null>;
  comment(repo: string, number: number, body: string): Promise<void>;
  review(
    repo: string,
    number: number,
    body: string,
    event: PRReviewEvent,
  ): Promise<void>;
  /** Post one review carrying an array of inline (line-level) comments. */
  createReview(
    repo: string,
    number: number,
    input: CreateReviewInput,
  ): Promise<void>;
  /** Reply in-thread to a review comment (…/pulls/{n}/comments/{comment_id}/replies).
   *  The code-review-refine node emits the reply text; the Floor posts it here
   *  (the agent pod has no `gh`). */
  replyToReviewComment(
    repo: string,
    number: number,
    commentId: number,
    body: string,
  ): Promise<void>;
  addLabel(repo: string, number: number, label: string): Promise<void>;
  merge(repo: string, number: number, method?: MergeMethod): Promise<void>;
  open(
    repo: string,
    branch: string,
    title: string,
    body: string,
    base?: string,
    labels?: string[],
  ): Promise<PullRef>;
  // reads
  getDiff(repo: string, number: number): Promise<string>;
  listReviews(repo: string, number: number): Promise<PullReview[]>;
  listComments(repo: string, number: number): Promise<ReviewComment[]>;
  listIssueComments(repo: string, number: number): Promise<IssueComment[]>;
  listCommits(repo: string, number: number): Promise<PullCommit[]>;
  isMerged(repo: string, number: number): Promise<boolean>;
  isClosed(repo: string, number: number): Promise<boolean>;
  getStats(repo: string, number: number): Promise<PullStats>;
  /** Number of files that differ between two refs (compare-commits). The agent-watcher
   *  uses this for the no-changes vs PR decision — `Agent.status` carries no changedFiles. */
  changedFileCount(repo: string, base: string, head: string): Promise<number>;
  /** Aggregate GitHub Actions conclusion for a ref — the deterministic gate (D3). */
  ciConclusion(repo: string, ref: string): Promise<CiConclusion>;
  /** Every changed filename on a PR — paginated so the auto-merge path gate can't
   *  silently truncate a large PR at one API page. */
  listFiles(repo: string, number: number): Promise<string[]>;
  /** Every check run for a ref — paginated, raw. The gate predicate stays in the caller
   *  (pr-policy needs `every(success|skipped)`, stricter than ciConclusion). */
  listChecks(repo: string, ref: string): Promise<CheckRun[]>;
}
