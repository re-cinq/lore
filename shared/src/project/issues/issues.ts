import type { GitHubPort, IssueRef, IssueFilter } from "../lib/github-port.js";

/**
 * project.issues — a value-object sub-facade over the GitHubPort. Cheap to
 * construct per access, so Project stays stateless.
 */
export class IssueCollection {
  constructor(
    private readonly repo: string,
    private readonly github: GitHubPort,
  ) {}

  list(filter?: IssueFilter): Promise<IssueRef[]> {
    return this.github.listIssues(this.repo, filter);
  }
}
