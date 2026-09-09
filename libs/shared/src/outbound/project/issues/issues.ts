import type {
  GitHubPort,
  IssueRef,
  IssueFilter,
  CloseReason,
} from "../lib/github-port.js";

/** Value-object sub-facade over GitHubPort (repo-bound); cheap to construct, keeps Project stateless. */
export class IssueCollection {
  constructor(
    private readonly repo: string,
    private readonly github: GitHubPort,
  ) {}

  list(filter?: IssueFilter): Promise<IssueRef[]> {
    return this.github.listIssues(this.repo, filter);
  }

  get(number: number): Promise<IssueRef | null> {
    return this.github.getIssue(this.repo, number);
  }

  /** Every label this repo defines — what an agent's chosen labels are checked against. */
  listLabels(): Promise<string[]> {
    return this.github.listLabels(this.repo);
  }

  create(title: string, body: string, labels?: string[]): Promise<IssueRef> {
    return this.github.createIssue(this.repo, title, body, labels);
  }

  createLabels(
    labels: Array<{ name: string; color?: string; description?: string }>,
  ): Promise<void> {
    return this.github.createLabels(this.repo, labels);
  }

  comment(number: number, body: string): Promise<void> {
    return this.github.commentOnIssue(this.repo, number, body);
  }

  close(number: number, reason?: CloseReason): Promise<void> {
    return this.github.closeIssue(this.repo, number, reason);
  }

  addLabel(number: number, label: string): Promise<void> {
    return this.github.addIssueLabel(this.repo, number, label);
  }

  removeLabel(number: number, label: string): Promise<void> {
    return this.github.removeIssueLabel(this.repo, number, label);
  }

  getLabels(number: number): Promise<string[]> {
    return this.github.getIssueLabels(this.repo, number);
  }
}
