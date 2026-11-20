import type {
  IssueComment,
  PullDraft,
  PullRef,
  SyncPulls,
} from "./pull-requests-port.js";

/** The pull request reads and writes the mirror sync needs, held in memory; numbers count up from 1 per instance. */
export class InMemoryPulls implements SyncPulls {
  private readonly pulls: PullRef[] = [];
  private readonly comments = new Map<string, IssueComment[]>();

  /** Newest first, as GitHub lists them. */
  async listByHead(repo: string, branch: string): Promise<PullRef[]> {
    return this.pulls
      .filter((pull) => pull.repo === repo && pull.branch === branch)
      .reverse();
  }

  async open(repo: string, branch: string, draft: PullDraft): Promise<PullRef> {
    const number = this.pulls.length + 1;
    const pull: PullRef = {
      repo,
      number,
      title: draft.title,
      branch,
      state: "open",
      labels: draft.labels ?? [],
      url: `https://github.com/${repo}/pull/${number}`,
      body: draft.body,
      baseBranch: draft.base,
    };

    this.pulls.push(pull);

    return pull;
  }

  async comment(repo: string, number: number, body: string): Promise<void> {
    const key = `${repo}#${number}`;
    const existing = this.comments.get(key) ?? [];

    this.comments.set(key, [
      ...existing,
      { id: existing.length + 1, body, user: "lore", created_at: "t" },
    ]);
  }

  async listIssueComments(
    repo: string,
    number: number,
  ): Promise<IssueComment[]> {
    return this.comments.get(`${repo}#${number}`) ?? [];
  }

  /** Marks pull request `number` merged with its head at `headSha`. */
  seedMerged(repo: string, number: number, headSha: string): void {
    const index = this.pulls.findIndex(
      (pull) => pull.repo === repo && pull.number === number,
    );

    this.pulls[index] = { ...this.pulls[index], state: "merged", headSha };
  }
}
