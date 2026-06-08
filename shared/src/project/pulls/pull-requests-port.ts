/**
 * The no-clone PR lifecycle port. Consumed by auto-merge + review-reactor,
 * which operate purely over the API and never clone. lib/platform-github
 * implements this alongside GitHubPort.
 */

export type PRReviewEvent = "APPROVE" | "REQUEST_CHANGES" | "COMMENT";
export type MergeMethod = "squash" | "merge" | "rebase";

export interface PullRef {
  repo: string;
  number: number;
  title: string;
  branch: string;
  state: "open" | "closed" | "merged";
  labels: string[];
  url: string;
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
  review(repo: string, number: number, body: string, event: PRReviewEvent): Promise<void>;
  addLabel(repo: string, number: number, label: string): Promise<void>;
  merge(repo: string, number: number, method?: MergeMethod): Promise<void>;
  open(repo: string, branch: string, title: string, body: string, base?: string): Promise<PullRef>;
  // reads
  getDiff(repo: string, number: number): Promise<string>;
  listReviews(repo: string, number: number): Promise<PullReview[]>;
  listComments(repo: string, number: number): Promise<ReviewComment[]>;
  listIssueComments(repo: string, number: number): Promise<IssueComment[]>;
  listCommits(repo: string, number: number): Promise<PullCommit[]>;
  isMerged(repo: string, number: number): Promise<boolean>;
  isClosed(repo: string, number: number): Promise<boolean>;
  getStats(repo: string, number: number): Promise<PullStats>;
}
