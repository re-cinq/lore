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
  /** The submitted review this inline comment belongs to. Absent on legacy doubles. */
  review_id?: number | null;
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

/** One inline comment inside a review thread — the GraphQL node, REST-mappable. */
export interface ReviewThreadComment {
  /** REST review-comment id (GraphQL `databaseId`) — the join key back to
   *  {@link ReviewComment.id}, so a reply posted over REST can find its thread. */
  databaseId: number | null;
}

/** One PR review thread. GraphQL-only surface: resolution state has no REST
 *  read, so `id` is the GraphQL node id — pass it to `resolveReviewThread`. */
export interface ReviewThread {
  id: string;
  isResolved: boolean;
  isOutdated: boolean;
  comments: ReviewThreadComment[];
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
    /** Open as a draft. A draft PR gets no Lore code review — both review entry
     *  points gate on `draft !== true` — which is what lets a line push many
     *  times before asking anyone to look. */
    draft?: boolean,
  ): Promise<PullRef>;
  /** Rewrite an open pull request's title and/or body. */
  update(
    repo: string,
    number: number,
    fields: { title?: string; body?: string },
  ): Promise<void>;
  /** Take a pull request out of draft, which is what starts the code review.
   *  GraphQL-only: REST's `pulls.update` has no `draft` field. Idempotent — a PR
   *  that is already ready is a no-op, because GitHub errors the mutation on one
   *  and a re-delivered event must not fail a run for work already done. */
  markReady(repo: string, number: number): Promise<void>;
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
  /** Every review thread on a PR — GraphQL, since resolution has no REST read. */
  listReviewThreads(repo: string, number: number): Promise<ReviewThread[]>;
  /** Mark one thread resolved. `threadId` is the globally unique GraphQL node
   *  id from listReviewThreads, so no repo parameter is needed. */
  resolveReviewThread(threadId: string): Promise<void>;
}
