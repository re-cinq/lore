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
}

export interface PullRequestsPort {
  list(repo: string): Promise<PullRef[]>;
  get(repo: string, number: number): Promise<PullRef | null>;
  comment(repo: string, number: number, body: string): Promise<void>;
  review(repo: string, number: number, body: string, event: PRReviewEvent): Promise<void>;
  addLabel(repo: string, number: number, label: string): Promise<void>;
  merge(repo: string, number: number, method?: MergeMethod): Promise<void>;
  open(repo: string, branch: string, title: string, body: string, base?: string): Promise<PullRef>;
}
