/**
 * Lightweight GitHub API client for the web-ui.
 * Uses a GitHub token (personal or App installation token) via GITHUB_TOKEN env.
 * Only implements getPRDetails needed for PR state visibility.
 */

export type PRStatus =
  | 'draft'
  | 'open'
  | 'checks-failing'
  | 'changes-requested'
  | 'approved'
  | 'merged'
  | 'closed';

export interface PRDetails {
  number: number;
  title: string;
  state: string;
  draft: boolean;
  merged: boolean;
  mergeable: boolean | null;
  html_url: string;
  checks: Array<{ name: string; status: string; conclusion: string | null }>;
  reviews: Array<{ user: string; state: string; submitted_at: string }>;
  computed_status: PRStatus;
}

export class GitHubPlatform {
  private token: string;

  constructor() {
    this.token = process.env.GITHUB_TOKEN || '';
  }

  isConfigured(): boolean {
    return !!this.token;
  }

  private async ghFetch(path: string): Promise<any> {
    const res = await fetch(`https://api.github.com${path}`, {
      headers: {
        Authorization: `Bearer ${this.token}`,
        Accept: 'application/vnd.github+json',
        'X-GitHub-Api-Version': '2022-11-28',
      },
    });
    if (!res.ok) throw new Error(`GitHub API ${path}: ${res.status} ${res.statusText}`);
    return res.json();
  }

  async getPRDetails(repo: string, prNumber: number): Promise<PRDetails> {
    const [pr, reviews] = await Promise.all([
      this.ghFetch(`/repos/${repo}/pulls/${prNumber}`),
      this.ghFetch(`/repos/${repo}/pulls/${prNumber}/reviews`).catch(() => []),
    ]);

    // Fetch checks via the PR head SHA
    let checkRuns: any[] = [];
    try {
      const checksResp = await this.ghFetch(`/repos/${repo}/commits/${pr.head.sha}/check-runs`);
      checkRuns = checksResp.check_runs || [];
    } catch {
      checkRuns = [];
    }

    const checks = checkRuns.map((c: any) => ({
      name: c.name,
      status: c.status,
      conclusion: c.conclusion ?? null,
    }));

    const reviewList: Array<{ user: string; state: string; submitted_at: string }> = Array.isArray(reviews)
      ? reviews.map((r: any) => ({
          user: r.user?.login || 'unknown',
          state: r.state,
          submitted_at: r.submitted_at || '',
        }))
      : [];

    let computed_status: PRStatus;
    if (pr.merged) {
      computed_status = 'merged';
    } else if (pr.state === 'closed') {
      computed_status = 'closed';
    } else if (pr.draft) {
      computed_status = 'draft';
    } else if (checks.some((c) => c.conclusion === 'failure' || c.conclusion === 'timed_out')) {
      computed_status = 'checks-failing';
    } else if (reviewList.some((r) => r.state === 'CHANGES_REQUESTED')) {
      computed_status = 'changes-requested';
    } else if (
      reviewList.some((r) => r.state === 'APPROVED') &&
      checks.every((c) => c.conclusion === 'success' || c.conclusion === 'skipped' || c.conclusion === null)
    ) {
      computed_status = 'approved';
    } else {
      computed_status = 'open';
    }

    return {
      number: pr.number,
      title: pr.title,
      state: pr.state,
      draft: pr.draft ?? false,
      merged: pr.merged,
      mergeable: pr.mergeable ?? null,
      html_url: pr.html_url,
      checks,
      reviews: reviewList,
      computed_status,
    };
  }
}
