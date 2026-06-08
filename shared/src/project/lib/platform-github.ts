import type { Octokit } from "octokit";
import type { GitHubPort, IssueRef, IssueFilter, IssueState } from "./github-port.js";
import type {
  PullRequestsPort,
  PullRef,
  PRReviewEvent,
  MergeMethod,
} from "../pulls/pull-requests-port.js";

/**
 * One GitHub adapter satisfying BOTH GitHubPort and PullRequestsPort. Auth is
 * the App-or-token resolution relocated from mcp-server/src/github-client.ts;
 * the REST calls are relocated from agent/src/github.ts. octokit is imported
 * lazily so the module stays loadable where octokit is absent.
 */
export class PlatformGitHub implements GitHubPort, PullRequestsPort {
  readonly name = "github";
  private client?: Promise<Octokit>;

  constructor(private readonly env: NodeJS.ProcessEnv = process.env) {}

  // ── GitHubPort ──────────────────────────────────────────────────────

  async listIssues(repo: string, filter?: IssueFilter): Promise<IssueRef[]> {
    const ok = await this.octo();
    const [owner, name] = split(repo);
    const { data } = await ok.rest.issues.listForRepo({
      owner,
      repo: name,
      state: filter?.state ?? "open",
      labels: filter?.labels?.join(","),
      per_page: 100,
    });
    return data
      .filter((i) => !i.pull_request)
      .map((i) => ({
        repo,
        number: i.number,
        title: i.title,
        state: i.state as IssueState,
        labels: i.labels.map((l) => (typeof l === "string" ? l : l.name ?? "")).filter(Boolean),
      }));
  }

  async getFileContent(repo: string, path: string, ref?: string): Promise<string | null> {
    const ok = await this.octo();
    const [owner, name] = split(repo);
    try {
      const { data } = await ok.rest.repos.getContent({ owner, repo: name, path, ...(ref ? { ref } : {}) });
      if (!Array.isArray(data) && data.type === "file" && data.content) {
        return Buffer.from(data.content, "base64").toString("utf-8");
      }
      return null;
    } catch {
      return null;
    }
  }

  async listDirectory(repo: string, path: string): Promise<string[]> {
    const ok = await this.octo();
    const [owner, name] = split(repo);
    try {
      const { data } = await ok.rest.repos.getContent({ owner, repo: name, path });
      return Array.isArray(data) ? data.map((e) => e.name) : [];
    } catch {
      return [];
    }
  }

  async listTree(repo: string, ref?: string): Promise<string[]> {
    const ok = await this.octo();
    const [owner, name] = split(repo);
    const branch = ref ?? (await this.defaultBranch(repo));
    const { data } = await ok.rest.git.getTree({ owner, repo: name, tree_sha: branch, recursive: "true" });
    return (data.tree ?? [])
      .filter((e) => e.type === "blob" && typeof e.path === "string")
      .map((e) => e.path as string);
  }

  // ── PullRequestsPort ────────────────────────────────────────────────

  async list(repo: string): Promise<PullRef[]> {
    const ok = await this.octo();
    const [owner, name] = split(repo);
    const { data } = await ok.rest.pulls.list({ owner, repo: name, state: "open", per_page: 100 });
    return data.map((pr) => toPullRef(repo, pr));
  }

  async get(repo: string, number: number): Promise<PullRef | null> {
    const ok = await this.octo();
    const [owner, name] = split(repo);
    try {
      const { data } = await ok.rest.pulls.get({ owner, repo: name, pull_number: number });
      return toPullRef(repo, data);
    } catch {
      return null;
    }
  }

  async comment(repo: string, number: number, body: string): Promise<void> {
    const ok = await this.octo();
    const [owner, name] = split(repo);
    await ok.rest.issues.createComment({ owner, repo: name, issue_number: number, body });
  }

  async review(repo: string, number: number, body: string, event: PRReviewEvent): Promise<void> {
    const ok = await this.octo();
    const [owner, name] = split(repo);
    await ok.rest.pulls.createReview({ owner, repo: name, pull_number: number, body, event });
  }

  async addLabel(repo: string, number: number, label: string): Promise<void> {
    const ok = await this.octo();
    const [owner, name] = split(repo);
    await ok.rest.issues.addLabels({ owner, repo: name, issue_number: number, labels: [label] });
  }

  async merge(repo: string, number: number, method: MergeMethod = "squash"): Promise<void> {
    const ok = await this.octo();
    const [owner, name] = split(repo);
    await ok.rest.pulls.merge({ owner, repo: name, pull_number: number, merge_method: method });
  }

  async open(repo: string, branch: string, title: string, body: string, base?: string): Promise<PullRef> {
    const ok = await this.octo();
    const [owner, name] = split(repo);
    const { data } = await ok.rest.pulls.create({
      owner,
      repo: name,
      title,
      body,
      head: branch,
      base: base ?? (await this.defaultBranch(repo)),
    });
    return toPullRef(repo, data);
  }

  // ── auth ────────────────────────────────────────────────────────────

  private octo(): Promise<Octokit> {
    if (!this.client) this.client = this.build();
    return this.client;
  }

  private async build(): Promise<Octokit> {
    const { Octokit } = await import("octokit");
    const appId = this.env.GITHUB_APP_ID;
    const privateKey = this.env.GITHUB_APP_PRIVATE_KEY;
    const installationId = this.env.GITHUB_APP_INSTALLATION_ID;
    if (appId && privateKey && installationId) {
      const { createAppAuth } = await import("@octokit/auth-app");
      return new Octokit({ authStrategy: createAppAuth, auth: { appId, privateKey, installationId } });
    }
    const token = this.env.GITHUB_TOKEN;
    if (token) return new Octokit({ auth: token });
    throw new Error(
      "GitHub not configured. Set GITHUB_APP_ID/PRIVATE_KEY/INSTALLATION_ID or GITHUB_TOKEN",
    );
  }

  private async defaultBranch(repo: string): Promise<string> {
    const ok = await this.octo();
    const [owner, name] = split(repo);
    const { data } = await ok.rest.repos.get({ owner, repo: name });
    return data.default_branch;
  }
}

function split(repo: string): [string, string] {
  const [owner, name] = repo.split("/");
  return [owner, name];
}

function toPullRef(repo: string, pr: { number: number; title: string; head: { ref: string }; state: string; merged_at?: string | null; labels?: Array<{ name: string }> }): PullRef {
  return {
    repo,
    number: pr.number,
    title: pr.title,
    branch: pr.head.ref,
    state: pr.merged_at ? "merged" : (pr.state as "open" | "closed"),
    labels: (pr.labels ?? []).map((l) => l.name),
  };
}
