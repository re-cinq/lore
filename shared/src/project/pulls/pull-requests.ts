import type {
  PullRequestsPort,
  PullRef,
  PRReviewEvent,
  MergeMethod,
  PullReview,
  ReviewComment,
  IssueComment,
  PullCommit,
  PullStats,
} from "./pull-requests-port.js";

/**
 * project.pulls — the canonical PR surface, repo bound. Workspace.openPr() is a
 * thin convenience that pushes the clone's branch then calls open() here.
 */
export class PullRequests {
  constructor(
    private readonly repo: string,
    private readonly pulls: PullRequestsPort,
  ) {}

  list(): Promise<PullRef[]> {
    return this.pulls.list(this.repo);
  }

  get(number: number): Promise<PullRef | null> {
    return this.pulls.get(this.repo, number);
  }

  comment(number: number, body: string): Promise<void> {
    return this.pulls.comment(this.repo, number, body);
  }

  review(number: number, body: string, event: PRReviewEvent): Promise<void> {
    return this.pulls.review(this.repo, number, body, event);
  }

  addLabel(number: number, label: string): Promise<void> {
    return this.pulls.addLabel(this.repo, number, label);
  }

  merge(number: number, method?: MergeMethod): Promise<void> {
    return this.pulls.merge(this.repo, number, method);
  }

  open(branch: string, title: string, body: string, base?: string): Promise<PullRef> {
    return this.pulls.open(this.repo, branch, title, body, base);
  }

  getDiff(number: number): Promise<string> {
    return this.pulls.getDiff(this.repo, number);
  }

  listReviews(number: number): Promise<PullReview[]> {
    return this.pulls.listReviews(this.repo, number);
  }

  listComments(number: number): Promise<ReviewComment[]> {
    return this.pulls.listComments(this.repo, number);
  }

  listIssueComments(number: number): Promise<IssueComment[]> {
    return this.pulls.listIssueComments(this.repo, number);
  }

  listCommits(number: number): Promise<PullCommit[]> {
    return this.pulls.listCommits(this.repo, number);
  }

  isMerged(number: number): Promise<boolean> {
    return this.pulls.isMerged(this.repo, number);
  }

  isClosed(number: number): Promise<boolean> {
    return this.pulls.isClosed(this.repo, number);
  }

  getStats(number: number): Promise<PullStats> {
    return this.pulls.getStats(this.repo, number);
  }
}
