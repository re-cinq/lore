import type { Octokit } from "octokit";
import { withoutBlindRetryOnCreates } from "./octokit-retry-policy.js";
import { enforceTrue } from "../../lib/enforce.js";
import type {
  GitHubPort,
  IssueRef,
  IssueFilter,
  IssueState,
  CloseReason,
  CheckRunInput,
} from "./github-port.js";
import type {
  PullRequestsPort,
  PullRef,
  PRReviewEvent,
  CreateReviewInput,
  MergeMethod,
  PullReview,
  ReviewComment,
  IssueComment,
  PullCommit,
  PullStats,
  CiConclusion,
  CheckRun,
  ReviewThread,
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

  isConfigured(): boolean {
    const {
      GITHUB_APP_ID,
      GITHUB_APP_PRIVATE_KEY,
      GITHUB_APP_INSTALLATION_ID,
      GITHUB_TOKEN,
    } = this.env;

    return (
      (!!GITHUB_APP_ID &&
        !!GITHUB_APP_PRIVATE_KEY &&
        !!GITHUB_APP_INSTALLATION_ID) ||
      !!GITHUB_TOKEN
    );
  }

  // ── GitHubPort ──────────────────────────────────────────────────────

  async listIssues(repo: string, filter?: IssueFilter): Promise<IssueRef[]> {
    const ok = await this.octo();
    const [owner, name] = split(repo);
    const data = await ok.paginate(ok.rest.issues.listForRepo, {
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
        labels: i.labels
          .map((l) => (typeof l === "string" ? l : (l.name ?? "")))
          .filter(Boolean),
        createdAt: i.created_at,
      }));
  }

  async getFileContent(
    repo: string,
    path: string,
    ref?: string,
  ): Promise<string | null> {
    const ok = await this.octo();
    const [owner, name] = split(repo);

    try {
      const { data } = await ok.rest.repos.getContent({
        owner,
        repo: name,
        path,
        ...(ref ? { ref } : {}),
      });

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
      const { data } = await ok.rest.repos.getContent({
        owner,
        repo: name,
        path,
      });

      return Array.isArray(data) ? data.map((e) => e.name) : [];
    } catch {
      return [];
    }
  }

  async listTree(repo: string, ref?: string): Promise<string[]> {
    const ok = await this.octo();
    const [owner, name] = split(repo);
    const branch = ref ?? (await this.defaultBranch(repo));
    // getTree is not a paginated endpoint (it returns the full recursive tree, truncated
    // only past ~100k entries) — leave it as a single call. A truncated tree
    // must throw, not return: the reindex verification pass prunes chunks of
    // files absent from this list, so a partial list reads as mass deletion.
    const { data } = await ok.rest.git.getTree({
      owner,
      repo: name,
      tree_sha: branch,
      recursive: "true",
    });

    enforceTrue(
      !data.truncated,
      Error,
      `Recursive tree fetch for ${repo} was truncated by GitHub — refusing to return a partial file list`,
    );

    return (data.tree ?? [])
      .filter((e) => e.type === "blob" && typeof e.path === "string")
      .map((e) => e.path as string);
  }

  getDefaultBranch(repo: string): Promise<string> {
    return this.defaultBranch(repo);
  }

  async listCommitsSince(
    repo: string,
    since: string,
  ): Promise<Array<{ sha: string; files: string[] }>> {
    const ok = await this.octo();
    const [owner, name] = split(repo);
    const commits = await ok.paginate(ok.rest.repos.listCommits, {
      owner,
      repo: name,
      since,
      per_page: 100,
    });
    const result: Array<{ sha: string; files: string[] }> = [];

    for (const c of commits) {
      try {
        const { data: detail } = await ok.rest.repos.getCommit({
          owner,
          repo: name,
          ref: c.sha,
        });

        result.push({
          sha: c.sha,
          files: (detail.files ?? []).map((f) => f.filename),
        });
      } catch {
        result.push({ sha: c.sha, files: [] });
      }
    }

    return result;
  }

  async getIssue(repo: string, number: number): Promise<IssueRef | null> {
    const ok = await this.octo();
    const [owner, name] = split(repo);

    try {
      const { data } = await ok.rest.issues.get({
        owner,
        repo: name,
        issue_number: number,
      });

      return {
        repo,
        number: data.number,
        title: data.title,
        state: data.state as IssueState,
        labels: data.labels
          .map((l) => (typeof l === "string" ? l : (l.name ?? "")))
          .filter(Boolean),
        url: data.html_url,
      };
    } catch {
      return null;
    }
  }

  async getIssueLabels(repo: string, number: number): Promise<string[]> {
    const ok = await this.octo();
    const [owner, name] = split(repo);
    const { data } = await ok.rest.issues.get({
      owner,
      repo: name,
      issue_number: number,
    });

    return data.labels
      .map((l) => (typeof l === "string" ? l : (l.name ?? "")))
      .filter(Boolean);
  }

  async createIssue(
    repo: string,
    title: string,
    body: string,
    labels: string[] = ["lore-managed"],
  ): Promise<IssueRef> {
    const ok = await this.octo();
    const [owner, name] = split(repo);
    const { data } = await ok.rest.issues.create({
      owner,
      repo: name,
      title,
      body,
      labels,
    });

    return {
      repo,
      number: data.number,
      title,
      state: "open",
      labels,
      url: data.html_url,
    };
  }

  async listLabels(repo: string): Promise<string[]> {
    const ok = await this.octo();
    const [owner, name] = split(repo);
    const labels = await ok.paginate(ok.rest.issues.listLabelsForRepo, {
      owner,
      repo: name,
      per_page: 100,
    });

    return labels.map((l) => l.name);
  }

  async createLabels(
    repo: string,
    labels: Array<{ name: string; color?: string; description?: string }>,
  ): Promise<void> {
    const ok = await this.octo();
    const [owner, name] = split(repo);

    for (const label of labels) {
      try {
        await ok.rest.issues.createLabel({
          owner,
          repo: name,
          name: label.name,
          color: label.color,
          description: label.description,
        });
      } catch (err) {
        if ((err as { status?: number }).status !== 422) {
          throw err;
        } // 422 = already exists
      }
    }
  }

  async commentOnIssue(
    repo: string,
    number: number,
    body: string,
  ): Promise<void> {
    const ok = await this.octo();
    const [owner, name] = split(repo);

    await ok.rest.issues.createComment({
      owner,
      repo: name,
      issue_number: number,
      body,
    });
  }

  async closeIssue(
    repo: string,
    number: number,
    reason: CloseReason = "completed",
  ): Promise<void> {
    const ok = await this.octo();
    const [owner, name] = split(repo);

    await ok.rest.issues.update({
      owner,
      repo: name,
      issue_number: number,
      state: "closed",
      state_reason: reason,
    });
  }

  async addIssueLabel(
    repo: string,
    number: number,
    label: string,
  ): Promise<void> {
    const ok = await this.octo();
    const [owner, name] = split(repo);

    await ok.rest.issues.addLabels({
      owner,
      repo: name,
      issue_number: number,
      labels: [label],
    });
  }

  async removeIssueLabel(
    repo: string,
    number: number,
    label: string,
  ): Promise<void> {
    const ok = await this.octo();
    const [owner, name] = split(repo);

    try {
      await ok.rest.issues.removeLabel({
        owner,
        repo: name,
        issue_number: number,
        name: label,
      });
    } catch {
      /* label might not exist */
    }
  }

  async branchExists(repo: string, branch: string): Promise<boolean> {
    const ok = await this.octo();
    const [owner, name] = split(repo);

    try {
      await ok.rest.git.getRef({ owner, repo: name, ref: `heads/${branch}` });

      return true;
    } catch (err) {
      if ((err as { status?: number }).status === 404) {
        return false;
      }

      throw err;
    }
  }

  async createBranch(
    repo: string,
    branch: string,
    base = "main",
  ): Promise<void> {
    const ok = await this.octo();
    const [owner, name] = split(repo);
    const { data: ref } = await ok.rest.git.getRef({
      owner,
      repo: name,
      ref: `heads/${base}`,
    });

    try {
      await ok.rest.git.createRef({
        owner,
        repo: name,
        ref: `refs/heads/${branch}`,
        sha: ref.object.sha,
      });
    } catch (err) {
      if ((err as { status?: number }).status === 422) {
        await ok.rest.git.deleteRef({
          owner,
          repo: name,
          ref: `heads/${branch}`,
        });
        await ok.rest.git.createRef({
          owner,
          repo: name,
          ref: `refs/heads/${branch}`,
          sha: ref.object.sha,
        });
      } else {
        throw err;
      }
    }
  }

  async commitFile(
    repo: string,
    branch: string,
    path: string,
    content: string,
    message: string,
  ): Promise<void> {
    const ok = await this.octo();
    const [owner, name] = split(repo);
    let sha: string | undefined;

    for (const ref of [branch, "main"]) {
      try {
        const { data } = await ok.rest.repos.getContent({
          owner,
          repo: name,
          path,
          ref,
        });

        if (!Array.isArray(data) && "sha" in data) {
          sha = data.sha;
          break;
        }
      } catch {
        /* not found on this ref */
      }
    }
    await ok.rest.repos.createOrUpdateFileContents({
      owner,
      repo: name,
      path,
      branch,
      message,
      content: Buffer.from(content).toString("base64"),
      ...(sha ? { sha } : {}),
    });
  }

  async upsertCheckRun(repo: string, input: CheckRunInput): Promise<void> {
    const ok = await this.octo();
    const [owner, name] = split(repo);
    const { data } = await ok.rest.checks.listForRef({
      owner,
      repo: name,
      ref: input.headSha,
      check_name: input.name,
    });
    const existing = data.check_runs[0];
    const output = { title: input.title, summary: input.summary };
    const fields = {
      status: input.status,
      ...(input.conclusion ? { conclusion: input.conclusion } : {}),
      ...(input.detailsUrl ? { details_url: input.detailsUrl } : {}),
      output,
    };

    if (existing) {
      await ok.rest.checks.update({
        owner,
        repo: name,
        check_run_id: existing.id,
        ...fields,
      });

      return;
    }
    await ok.rest.checks.create({
      owner,
      repo: name,
      name: input.name,
      head_sha: input.headSha,
      ...fields,
    });
  }

  // ── PullRequestsPort ────────────────────────────────────────────────

  async list(repo: string): Promise<PullRef[]> {
    const ok = await this.octo();
    const [owner, name] = split(repo);
    const data = await ok.paginate(ok.rest.pulls.list, {
      owner,
      repo: name,
      state: "open",
      per_page: 100,
    });

    return data.map((pr) => toPullRef(repo, pr));
  }

  async get(repo: string, number: number): Promise<PullRef | null> {
    const ok = await this.octo();
    const [owner, name] = split(repo);

    try {
      const { data } = await ok.rest.pulls.get({
        owner,
        repo: name,
        pull_number: number,
      });

      return toPullRef(repo, data);
    } catch {
      return null;
    }
  }

  async comment(repo: string, number: number, body: string): Promise<void> {
    const ok = await this.octo();
    const [owner, name] = split(repo);

    await ok.rest.issues.createComment({
      owner,
      repo: name,
      issue_number: number,
      body,
    });
  }

  async review(
    repo: string,
    number: number,
    body: string,
    event: PRReviewEvent,
  ): Promise<void> {
    const ok = await this.octo();
    const [owner, name] = split(repo);

    await ok.rest.pulls.createReview({
      owner,
      repo: name,
      pull_number: number,
      body,
      event,
    });
  }

  async createReview(
    repo: string,
    number: number,
    input: CreateReviewInput,
  ): Promise<void> {
    const ok = await this.octo();
    const [owner, name] = split(repo);

    await ok.rest.pulls.createReview({
      owner,
      repo: name,
      pull_number: number,
      body: input.body,
      event: input.event,
      comments: input.comments.map((c) => ({
        path: c.path,
        line: c.line,
        ...(c.side ? { side: c.side } : {}),
        body: c.body,
      })),
    });
  }

  async replyToReviewComment(
    repo: string,
    number: number,
    commentId: number,
    body: string,
  ): Promise<void> {
    const ok = await this.octo();
    const [owner, name] = split(repo);

    await ok.rest.pulls.createReplyForReviewComment({
      owner,
      repo: name,
      pull_number: number,
      comment_id: commentId,
      body,
    });
  }

  async addLabel(repo: string, number: number, label: string): Promise<void> {
    const ok = await this.octo();
    const [owner, name] = split(repo);

    await ok.rest.issues.addLabels({
      owner,
      repo: name,
      issue_number: number,
      labels: [label],
    });
  }

  async merge(
    repo: string,
    number: number,
    method: MergeMethod = "squash",
  ): Promise<void> {
    const ok = await this.octo();
    const [owner, name] = split(repo);

    await ok.rest.pulls.merge({
      owner,
      repo: name,
      pull_number: number,
      merge_method: method,
    });
  }

  async open(
    repo: string,
    branch: string,
    title: string,
    body: string,
    base?: string,
    labels: string[] = ["agent-generated"],
  ): Promise<PullRef> {
    const ok = await this.octo();
    const [owner, name] = split(repo);
    const { data } = await ok.rest.pulls.create({
      owner,
      repo: name,
      title,
      body,
      head: branch,
      base: base ?? "main",
    });

    if (labels.length > 0) {
      await ok.rest.issues.addLabels({
        owner,
        repo: name,
        issue_number: data.number,
        labels,
      });
    }

    return toPullRef(repo, data);
  }

  async getDiff(repo: string, number: number): Promise<string> {
    const ok = await this.octo();
    const [owner, name] = split(repo);
    const { data } = await ok.rest.pulls.get({
      owner,
      repo: name,
      pull_number: number,
      mediaType: { format: "diff" },
    });

    return data as unknown as string;
  }

  async listReviews(repo: string, number: number): Promise<PullReview[]> {
    const ok = await this.octo();
    const [owner, name] = split(repo);
    const data = await ok.paginate(ok.rest.pulls.listReviews, {
      owner,
      repo: name,
      pull_number: number,
    });

    return data.map((r) => ({
      id: r.id,
      state: r.state,
      body: r.body ?? "",
      user: r.user?.login ?? "unknown",
      submitted_at: r.submitted_at ?? "",
    }));
  }

  async listComments(repo: string, number: number): Promise<ReviewComment[]> {
    const ok = await this.octo();
    const [owner, name] = split(repo);
    const data = await ok.paginate(ok.rest.pulls.listReviewComments, {
      owner,
      repo: name,
      pull_number: number,
    });

    return data.map((c) => ({
      id: c.id,
      path: c.path,
      line: c.line ?? c.original_line ?? null,
      body: c.body,
      user: c.user?.login ?? "unknown",
      created_at: c.created_at,
      review_id: c.pull_request_review_id ?? null,
    }));
  }

  async listReviewThreads(
    repo: string,
    number: number,
  ): Promise<ReviewThread[]> {
    const ok = await this.octo();
    const [owner, name] = split(repo);
    const threads: ReviewThread[] = [];
    let cursor: string | null = null;
    let hasNextPage = true;

    while (hasNextPage) {
      const data: ReviewThreadsResponse = await ok.graphql(
        `query ($owner: String!, $name: String!, $number: Int!, $cursor: String) {
          repository(owner: $owner, name: $name) {
            pullRequest(number: $number) {
              reviewThreads(first: 100, after: $cursor) {
                pageInfo { hasNextPage endCursor }
                nodes {
                  id
                  isResolved
                  isOutdated
                  comments(first: 100) {
                    pageInfo { hasNextPage }
                    nodes { databaseId }
                  }
                }
              }
            }
          }
        }`,
        { owner, name, number, cursor },
      );
      const page = data.repository?.pullRequest?.reviewThreads;

      if (!page) {
        break;
      }

      for (const n of page.nodes) {
        // The accepted cap (a 100+-comment thread is out of scope) — but say so
        // when it actually bites, or a failed databaseId join reads as "no
        // thread" instead of "comment past the cap".
        if (n.comments.pageInfo?.hasNextPage) {
          console.warn(
            `[github] review thread ${n.id} on ${repo}#${number} has >100 comments — late comments will not join by databaseId`,
          );
        }
        threads.push({
          id: n.id,
          isResolved: n.isResolved,
          isOutdated: n.isOutdated,
          comments: n.comments.nodes.map((c) => ({
            databaseId: c.databaseId,
          })),
        });
      }
      hasNextPage = page.pageInfo.hasNextPage;
      cursor = page.pageInfo.endCursor;
    }

    return threads;
  }

  async resolveReviewThread(threadId: string): Promise<void> {
    const ok = await this.octo();

    await ok.graphql(
      `mutation ($threadId: ID!) {
        resolveReviewThread(input: { threadId: $threadId }) {
          thread { id isResolved }
        }
      }`,
      { threadId },
    );
  }

  async listIssueComments(
    repo: string,
    number: number,
  ): Promise<IssueComment[]> {
    const ok = await this.octo();
    const [owner, name] = split(repo);
    const data = await ok.paginate(ok.rest.issues.listComments, {
      owner,
      repo: name,
      issue_number: number,
    });

    return data
      .filter(
        (c) =>
          !c.body?.startsWith("PR created:") &&
          !c.body?.startsWith("Agent ") &&
          !c.body?.startsWith("Task "),
      )
      .map((c) => ({
        body: c.body ?? "",
        user: c.user?.login ?? "unknown",
        created_at: c.created_at,
      }));
  }

  async listCommits(repo: string, number: number): Promise<PullCommit[]> {
    const ok = await this.octo();
    const [owner, name] = split(repo);
    const data = await ok.paginate(ok.rest.pulls.listCommits, {
      owner,
      repo: name,
      pull_number: number,
    });

    return data.map((c) => ({
      sha: c.sha,
      message: c.commit.message,
      date: c.commit.committer?.date ?? "",
    }));
  }

  async isMerged(repo: string, number: number): Promise<boolean> {
    const ok = await this.octo();
    const [owner, name] = split(repo);
    const { data } = await ok.rest.pulls.get({
      owner,
      repo: name,
      pull_number: number,
    });

    return data.merged;
  }

  async isClosed(repo: string, number: number): Promise<boolean> {
    const ok = await this.octo();
    const [owner, name] = split(repo);
    const { data } = await ok.rest.pulls.get({
      owner,
      repo: name,
      pull_number: number,
    });

    return data.state === "closed" && !data.merged;
  }

  async getStats(repo: string, number: number): Promise<PullStats> {
    const ok = await this.octo();
    const [owner, name] = split(repo);
    const { data } = await ok.rest.pulls.get({
      owner,
      repo: name,
      pull_number: number,
    });

    return {
      files_changed: data.changed_files,
      additions: data.additions,
      deletions: data.deletions,
      comments: data.comments + data.review_comments,
      merged_at: data.merged_at,
      created_at: data.created_at,
    };
  }

  async changedFileCount(
    repo: string,
    base: string,
    head: string,
  ): Promise<number> {
    const ok = await this.octo();
    const [owner, name] = split(repo);
    const { data } = await ok.rest.repos.compareCommitsWithBasehead({
      owner,
      repo: name,
      basehead: `${base}...${head}`,
    });

    return data.files?.length ?? 0;
  }

  /** All check runs for a ref, paginated once — the source for both ciConclusion
   *  and the raw listChecks the auto-merge gate reads. */
  private async checkRuns(repo: string, ref: string): Promise<CheckRun[]> {
    const ok = await this.octo();
    const [owner, name] = split(repo);
    const runs = await ok.paginate(ok.rest.checks.listForRef, {
      owner,
      repo: name,
      ref,
      per_page: 100,
    });

    return runs.map((r) => ({
      name: r.name,
      status: r.status,
      conclusion: r.conclusion,
    }));
  }

  listChecks(repo: string, ref: string): Promise<CheckRun[]> {
    return this.checkRuns(repo, ref);
  }

  async listFiles(repo: string, number: number): Promise<string[]> {
    const ok = await this.octo();
    const [owner, name] = split(repo);
    const files = await ok.paginate(ok.rest.pulls.listFiles, {
      owner,
      repo: name,
      pull_number: number,
      per_page: 100,
    });

    return files.map((f) => f.filename);
  }

  async ciConclusion(repo: string, ref: string): Promise<CiConclusion> {
    const runs = await this.checkRuns(repo, ref);

    if (runs.length === 0) {
      return "none";
    }

    if (runs.some((r) => r.status !== "completed")) {
      return "pending";
    }
    const failed = new Set([
      "failure",
      "cancelled",
      "timed_out",
      "action_required",
      "stale",
    ]);

    if (runs.some((r) => r.conclusion != null && failed.has(r.conclusion))) {
      return "failure";
    }

    return "success";
  }

  // ── repo config (consumed by the settings adapter) ──────────────────

  async setRepoVariable(
    repo: string,
    name: string,
    value: string,
  ): Promise<void> {
    const ok = await this.octo();
    const [owner, repoName] = split(repo);

    try {
      await ok.rest.actions.updateRepoVariable({
        owner,
        repo: repoName,
        name,
        value,
      });
    } catch {
      await ok.rest.actions.createRepoVariable({
        owner,
        repo: repoName,
        name,
        value,
      });
    }
  }

  async setRepoSecret(
    repo: string,
    name: string,
    value: string,
  ): Promise<void> {
    const ok = await this.octo();
    const [owner, repoName] = split(repo);
    const { data: pubKey } = await ok.rest.actions.getRepoPublicKey({
      owner,
      repo: repoName,
    });
    // Indirected through a variable so tsc does not demand a declaration file for
    // an untyped package. The cost is that every static dependency checker is blind
    // to this import, so the declaration is pinned by runtime-deps.test.ts — it is a
    // production dependency of libs/shared, not the Floor's and not a devDependency.
    const spec = "libsodium-wrappers";
    const sodium = ((await import(spec)) as { default: Sodium }).default;

    await sodium.ready;
    const keyBytes = sodium.from_base64(
      pubKey.key,
      sodium.base64_variants.ORIGINAL,
    );
    const encrypted = sodium.crypto_box_seal(
      sodium.from_string(value),
      keyBytes,
    );
    const encryptedValue = sodium.to_base64(
      encrypted,
      sodium.base64_variants.ORIGINAL,
    );

    await ok.rest.actions.createOrUpdateRepoSecret({
      owner,
      repo: repoName,
      secret_name: name,
      encrypted_value: encryptedValue,
      key_id: pubKey.key_id,
    });
  }

  // ── auth ────────────────────────────────────────────────────────────

  /**
   * The GitHub App installation token, for the git-auth helper's clone/push
   * credential. Not on GitHubPort — its consumers (GithubTokenMinter, the git-auth
   * call sites) depend on the structural `{ getInstallationToken(): Promise<string> }`,
   * which keeps the Project facade token-free.
   */
  async getInstallationToken(): Promise<string> {
    const ok = await this.octo();
    const auth = (await ok.auth({ type: "installation" })) as { token: string };

    return auth.token;
  }

  private octo(): Promise<Octokit> {
    if (!this.client) {
      this.client = this.build();
    }

    return this.client;
  }

  private async build(): Promise<Octokit> {
    const { Octokit } = await import("octokit");
    const appId = this.env.GITHUB_APP_ID;
    const privateKey = this.env.GITHUB_APP_PRIVATE_KEY;
    const installationId = this.env.GITHUB_APP_INSTALLATION_ID;

    if (appId && privateKey && installationId) {
      const { createAppAuth } = await import("@octokit/auth-app");

      return withoutBlindRetryOnCreates(
        new Octokit({
          authStrategy: createAppAuth,
          auth: { appId, privateKey, installationId },
        }),
      );
    }
    const token = this.env.GITHUB_TOKEN;

    if (token) {
      return withoutBlindRetryOnCreates(new Octokit({ auth: token }));
    }
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

interface Sodium {
  ready: Promise<void>;
  base64_variants: { ORIGINAL: number };
  from_base64(input: string, variant: number): Uint8Array;
  from_string(input: string): Uint8Array;
  crypto_box_seal(message: Uint8Array, publicKey: Uint8Array): Uint8Array;
  to_base64(input: Uint8Array, variant: number): string;
}

/** The reviewThreads GraphQL response — only the fields the mapper reads. */
interface ReviewThreadsResponse {
  repository?: {
    pullRequest?: {
      reviewThreads: {
        pageInfo: { hasNextPage: boolean; endCursor: string | null };
        nodes: Array<{
          id: string;
          isResolved: boolean;
          isOutdated: boolean;
          comments: {
            pageInfo?: { hasNextPage: boolean };
            nodes: Array<{ databaseId: number | null }>;
          };
        }>;
      };
    };
  };
}

function split(repo: string): [string, string] {
  const [owner, name] = repo.split("/");

  return [owner, name];
}

function toPullRef(
  repo: string,
  pr: {
    number: number;
    title: string;
    head: { ref: string; sha?: string };
    state: string;
    merged_at?: string | null;
    html_url: string;
    labels?: Array<{ name: string }>;
    user?: { login?: string } | null;
    draft?: boolean;
  },
): PullRef {
  return {
    repo,
    number: pr.number,
    title: pr.title,
    branch: pr.head.ref,
    state: pr.merged_at ? "merged" : (pr.state as "open" | "closed"),
    labels: (pr.labels ?? []).map((l) => l.name),
    url: pr.html_url,
    author: pr.user?.login ?? "",
    draft: pr.draft ?? false,
    headSha: pr.head.sha,
  };
}
