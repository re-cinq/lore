import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { PlatformGitHub } from "./platform-github.js";

interface FakeFile {
  filename: string;
  status: string;
  additions: number;
  deletions: number;
  patch?: string;
  previous_filename?: string;
}

const state: {
  files: FakeFile[];
  checkRuns: Array<{
    id?: number;
    app?: { slug: string } | null;
    name: string;
    status: string;
    conclusion: string | null;
    output: { title: string | null; summary: string | null };
  }>;
  token: string;
  labelError?: { status?: number };
  reviewCall?: Record<string, unknown>;
  prData?: Record<string, unknown>;
  treeData?: Record<string, unknown>;
  issuesData?: Array<Record<string, unknown>>;
  pullsPages?: Array<Array<Record<string, unknown>>>;
  pullsListCall?: Record<string, unknown>;
  pagesServed: number;
  issueData?: Record<string, unknown>;
  blockersData?: Array<{ number: number; state: string }>;
  blockersCall?: Record<string, unknown>;
  reviewThreadPages?: Array<Record<string, unknown>>;
  graphqlCalls: Array<{ query: string; vars: Record<string, unknown> }>;
  authCalls: Array<Record<string, unknown>>;
  createCall?: Record<string, unknown>;
  updateCall?: Record<string, unknown>;
  prNode?: { id: string; isDraft: boolean };
  job?: { steps: Array<{ name: string; conclusion: string | null }> };
  jobLog?: string;
  jobError?: { status: number };
  branchCommits?: Array<{
    sha: string;
    commit: {
      message: string;
      committer: { date: string } | null;
      author?: { email: string } | null;
    };
  }>;
  annotations?: Array<{
    path: string;
    start_line: number;
    annotation_level: string;
    message: string;
  }>;
} = {
  files: [],
  checkRuns: [],
  token: "",
  graphqlCalls: [],
  authCalls: [],
  pagesServed: 0,
};

vi.mock("octokit", () => ({
  Octokit: class {
    hook = { before: () => {} };
    auth = async (options: Record<string, unknown> = {}) => {
      state.authCalls.push(options);

      return { token: state.token };
    };
    graphql = async (query: string, vars: Record<string, unknown>) => {
      state.graphqlCalls.push({ query, vars });

      if (query.trimStart().startsWith("mutation")) {
        return { resolveReviewThread: { thread: { id: vars.threadId } } };
      }

      if (query.includes("isDraft")) {
        return { repository: { pullRequest: state.prNode ?? null } };
      }
      const page = (state.reviewThreadPages ?? []).shift() ?? {
        nodes: [],
        pageInfo: { hasNextPage: false, endCursor: null },
      };

      return { repository: { pullRequest: { reviewThreads: page } } };
    };
    paginate = Object.assign(
      async (fn: (p: unknown) => Promise<unknown[]>, params: unknown) =>
        fn(params),
      {
        iterator: async function* (
          fn: (p: unknown) => Promise<unknown>,
          params: unknown,
        ) {
          await fn(params);

          for (const page of state.pullsPages ?? []) {
            state.pagesServed += 1;
            yield { data: page };
          }
        },
      },
    );
    rest = {
      pulls: {
        list: async (params: Record<string, unknown>) => {
          state.pullsListCall = params;

          return [];
        },
        listFiles: async () => state.files,
        get: async () => ({ data: state.prData }),
        createReview: async (params: Record<string, unknown>) => {
          state.reviewCall = params;
        },
        create: async (params: Record<string, unknown>) => {
          state.createCall = params;

          return {
            data: {
              number: 7,
              title: "T",
              head: { ref: "topic" },
              state: "open",
              html_url: "https://gh/pr/7",
              draft: params.draft === true,
            },
          };
        },
        update: async (params: Record<string, unknown>) => {
          state.updateCall = params;
        },
      },
      checks: {
        listForRef: async () => state.checkRuns,
        listAnnotations: async () => state.annotations ?? [],
      },
      actions: {
        getJobForWorkflowRun: async () => {
          if (state.jobError) {
            throw state.jobError;
          }

          return { data: state.job };
        },
        downloadJobLogsForWorkflowRun: async () => {
          if (state.jobError) {
            throw state.jobError;
          }

          return { data: state.jobLog };
        },
      },
      git: { getTree: async () => ({ data: state.treeData }) },
      repos: {
        listCommits: async () => ({ data: state.branchCommits ?? [] }),
      },
      issues: {
        addLabels: async () => ({}),
        listForRepo: async () => state.issuesData ?? [],
        get: async () => ({ data: state.issueData }),
        listDependenciesBlockedBy: async (params: Record<string, unknown>) => {
          state.blockersCall = params;

          return state.blockersData ?? [];
        },
        createLabel: async () => {
          if (state.labelError) {
            throw state.labelError;
          }
        },
      },
    };
  },
}));

describe("PlatformGitHub auth", () => {
  it("throws a clear config error when neither App creds nor a token are set", async () => {
    const gh = new PlatformGitHub({});

    await expect(gh.listIssues("re-cinq/lore")).rejects.toThrow(
      "GitHub not configured. Set GITHUB_APP_ID/PRIVATE_KEY/INSTALLATION_ID or GITHUB_TOKEN",
    );
  });

  it("exposes the github port name", () => {
    expect(new PlatformGitHub({}).name).toBe("github");
  });
});

describe("PlatformGitHub paginated reads + helpers", () => {
  const gh = () => new PlatformGitHub({ GITHUB_TOKEN: "gh-token" });

  beforeEach(() => {
    state.files = [];
    state.checkRuns = [];
    state.token = "";
    state.labelError = undefined;
    state.reviewCall = undefined;
    state.prData = undefined;
    state.treeData = undefined;
    state.issuesData = undefined;
    state.pullsPages = undefined;
    state.pagesServed = 0;
  });
  afterEach(() => vi.clearAllMocks());

  const closedPull = (
    number: number,
    updatedAt: string,
    mergedAt: string | null,
  ) => ({
    number,
    title: `PR ${number}`,
    head: { ref: `b${number}` },
    state: "closed",
    html_url: `https://gh/pr/${number}`,
    updated_at: updatedAt,
    merged_at: mergedAt,
    body: `Closes #${number}`,
    user: { login: "alice" },
  });

  it("listMergedSince keeps only pulls merged at or after the cutoff, newest first", async () => {
    state.pullsPages = [
      [
        closedPull(3, "2026-09-25T09:00:00Z", "2026-09-25T08:00:00Z"),
        closedPull(2, "2026-09-25T07:00:00Z", null),
        closedPull(1, "2026-09-23T07:00:00Z", "2026-09-23T07:00:00Z"),
      ],
    ];
    const merged = await gh().listMergedSince(
      "re-cinq/lore",
      "2026-09-24T07:00:00Z",
    );

    expect(merged).toEqual([
      expect.objectContaining({
        number: 3,
        state: "merged",
        mergedAt: "2026-09-25T08:00:00Z",
        body: "Closes #3",
        author: "alice",
      }),
    ]);
    expect(state.pullsListCall).toMatchObject({
      state: "closed",
      sort: "updated",
      direction: "desc",
    });
  });

  it("listMergedSince stops paging once a closed pull is older than the cutoff", async () => {
    state.pullsPages = [
      [
        closedPull(3, "2026-09-25T09:00:00Z", "2026-09-25T08:00:00Z"),
        closedPull(1, "2026-09-23T07:00:00Z", "2026-09-23T07:00:00Z"),
      ],
      [closedPull(0, "2026-09-01T07:00:00Z", "2026-09-01T07:00:00Z")],
    ];
    await gh().listMergedSince("re-cinq/lore", "2026-09-24T07:00:00Z");

    expect(state.pagesServed).toBe(1);
  });

  it("listMergedSince keeps paging while every pull is inside the window", async () => {
    state.pullsPages = [
      [closedPull(3, "2026-09-25T09:00:00Z", "2026-09-25T08:00:00Z")],
      [closedPull(2, "2026-09-25T08:00:00Z", "2026-09-25T07:30:00Z")],
    ];
    const merged = await gh().listMergedSince(
      "re-cinq/lore",
      "2026-09-24T07:00:00Z",
    );

    expect(merged.map((pr) => pr.number)).toEqual([3, 2]);
  });

  it("listIssues maps assignee logins onto assignees and close time onto closedAt", async () => {
    state.issuesData = [
      {
        number: 21,
        title: "Owned",
        state: "closed",
        labels: [],
        html_url: "https://gh/i/21",
        created_at: "2026-09-01T09:00:00Z",
        closed_at: "2026-09-25T06:00:00Z",
        assignees: [{ login: "alice" }, { login: "bob" }],
      },
    ];
    const [issue] = await gh().listIssues("re-cinq/lore", { state: "closed" });

    expect(issue).toMatchObject({
      number: 21,
      assignees: ["alice", "bob"],
      closedAt: "2026-09-25T06:00:00Z",
    });
  });

  it("listIssues keeps only issues closed at or after since when listing closed ones", async () => {
    const closed = (number: number, closedAt: string) => ({
      number,
      title: `Issue ${number}`,
      state: "closed",
      labels: [],
      html_url: `https://gh/i/${number}`,
      created_at: "2026-09-01T09:00:00Z",
      closed_at: closedAt,
    });

    state.issuesData = [
      closed(30, "2026-09-25T06:00:00Z"),
      closed(31, "2026-09-20T06:00:00Z"),
    ];
    const issues = await gh().listIssues("re-cinq/lore", {
      state: "closed",
      since: "2026-09-24T07:00:00Z",
    });

    expect(issues.map((i) => i.number)).toEqual([30]);
  });

  it("listIssues maps created_at to createdAt and drops pull requests", async () => {
    state.issuesData = [
      {
        number: 12,
        title: "Slow queries",
        state: "open",
        labels: [{ name: "priority:high" }, "bug"],
        html_url: "https://gh/i/12",
        created_at: "2026-08-02T09:00:00Z",
      },
      {
        number: 13,
        title: "A PR, not an issue",
        state: "open",
        labels: [],
        created_at: "2026-08-03T09:00:00Z",
        pull_request: {},
      },
    ];
    const issues = await gh().listIssues("re-cinq/lore");

    expect(issues).toEqual([
      {
        repo: "re-cinq/lore",
        number: 12,
        title: "Slow queries",
        state: "open",
        labels: ["priority:high", "bug"],
        url: "https://gh/i/12",
        createdAt: "2026-08-02T09:00:00Z",
      },
    ]);
  });

  it("listIssues carries the issue body and omits a null one", async () => {
    state.issuesData = [
      {
        number: 14,
        title: "Broken links",
        state: "open",
        labels: [],
        html_url: "https://gh/i/14",
        created_at: "2026-08-02T09:00:00Z",
        body: "248 links across 23 specs don't resolve.",
      },
      {
        number: 15,
        title: "Bodyless",
        state: "open",
        labels: [],
        html_url: "https://gh/i/15",
        created_at: "2026-08-02T09:00:00Z",
        body: null,
      },
    ];
    const issues = await gh().listIssues("re-cinq/lore");

    expect(issues[0]).toMatchObject({
      number: 14,
      body: "248 links across 23 specs don't resolve.",
    });
    expect(issues[1]).not.toHaveProperty("body");
  });

  it("listIssues carries a blocked-by link count of 3 and omits a count of 0", async () => {
    const dependent = (number: number, totalBlockedBy: number) => ({
      number,
      title: `Ticket ${number}`,
      state: "open",
      labels: [],
      html_url: `https://gh/i/${number}`,
      created_at: "2026-08-02T09:00:00Z",
      issue_dependencies_summary: {
        blocked_by: totalBlockedBy,
        total_blocked_by: totalBlockedBy,
      },
    });

    state.issuesData = [dependent(16, 3), dependent(17, 0)];
    const issues = await gh().listIssues("re-cinq/lore");

    expect(issues[0]).toMatchObject({ number: 16, blockedByCount: 3 });
    expect(issues[1]).not.toHaveProperty("blockedByCount");
  });

  it("listOpenBlockers asks for #16's blockers and returns only the open #39 and #155", async () => {
    state.blockersData = [
      { number: 39, state: "open" },
      { number: 23, state: "closed" },
      { number: 155, state: "open" },
    ];

    await expect(gh().listOpenBlockers("re-cinq/lore", 16)).resolves.toEqual([
      39, 155,
    ]);
    expect(state.blockersCall).toMatchObject({
      owner: "re-cinq",
      repo: "lore",
      issue_number: 16,
    });
  });

  it("listFiles returns every changed filename (paginated past one page)", async () => {
    state.files = Array.from({ length: 31 }, (_, i) => ({
      filename: `src/f${i}.ts`,
      status: "modified",
      additions: 1,
      deletions: 0,
    }));
    const files = await gh().listFiles("re-cinq/lore", 7);

    expect(files).toHaveLength(31);
    expect(files).toContain("src/f30.ts");
  });

  it("getIssue carries the issue body and omits a null one", async () => {
    const issue = {
      number: 9,
      title: "Render the issue",
      state: "open",
      labels: [{ name: "lore-managed" }],
      html_url: "https://gh/re-cinq/lore/issues/9",
    };

    state.issueData = { ...issue, body: "## Why\nno tab switch" };
    const withBody = await gh().getIssue("re-cinq/lore", 9);

    state.issueData = { ...issue, body: null };
    const withoutBody = await gh().getIssue("re-cinq/lore", 9);
    const ref = {
      repo: "re-cinq/lore",
      number: 9,
      title: "Render the issue",
      state: "open",
      labels: ["lore-managed"],
      url: "https://gh/re-cinq/lore/issues/9",
    };

    expect({ withBody, withoutBody }).toEqual({
      withBody: { ...ref, body: "## Why\nno tab switch" },
      withoutBody: ref,
    });
  });

  it("listFileChanges returns status, additions, deletions and patch per file across pages", async () => {
    state.files = [
      ...Array.from({ length: 30 }, (_, i) => ({
        filename: `src/f${i}.ts`,
        status: "modified",
        additions: 1,
        deletions: 0,
        patch: `@@ -1 +1 @@\n-old${i}\n+new${i}`,
      })),
      {
        filename: "src/renamed.ts",
        status: "renamed",
        additions: 0,
        deletions: 0,
        previous_filename: "src/original.ts",
      },
      { filename: "logo.png", status: "added", additions: 0, deletions: 0 },
    ];
    const changes = await gh().listFileChanges("re-cinq/lore", 7);

    expect(changes).toHaveLength(32);
    expect(changes[29]).toEqual({
      filename: "src/f29.ts",
      status: "modified",
      additions: 1,
      deletions: 0,
      patch: "@@ -1 +1 @@\n-old29\n+new29",
    });
    expect(changes[30]).toEqual({
      filename: "src/renamed.ts",
      status: "renamed",
      additions: 0,
      deletions: 0,
      patch: null,
      previousFilename: "src/original.ts",
    });
    expect(changes[31]).toEqual({
      filename: "logo.png",
      status: "added",
      additions: 0,
      deletions: 0,
      patch: null,
    });
  });

  it("listChecks maps each run to name/status/conclusion", async () => {
    state.checkRuns = [
      {
        name: "build",
        status: "completed",
        conclusion: "success",
        output: { title: null, summary: null },
      },
    ];
    expect(await gh().listChecks("re-cinq/lore", "abc")).toEqual([
      {
        name: "build",
        status: "completed",
        conclusion: "success",
        output: { title: null, summary: null },
      },
    ]);
  });

  it("listChecks carries the output title and summary a job reported", async () => {
    state.checkRuns = [
      {
        name: "lint",
        status: "completed",
        conclusion: "failure",
        output: { title: "3 problems", summary: "no-unused-vars" },
      },
    ];
    expect(await gh().listChecks("re-cinq/lore", "abc")).toEqual([
      {
        name: "lint",
        status: "completed",
        conclusion: "failure",
        output: { title: "3 problems", summary: "no-unused-vars" },
      },
    ]);
  });

  it("ciConclusion reports failure when any check failed", async () => {
    state.checkRuns = [
      {
        name: "a",
        status: "completed",
        conclusion: "success",
        output: { title: null, summary: null },
      },
      {
        name: "b",
        status: "completed",
        conclusion: "failure",
        output: { title: null, summary: null },
      },
    ];
    expect(await gh().ciConclusion("re-cinq/lore", "abc")).toBe("failure");
  });

  it("ciConclusion reports pending while a check is not completed", async () => {
    state.checkRuns = [
      {
        name: "a",
        status: "in_progress",
        conclusion: null,
        output: { title: null, summary: null },
      },
    ];
    expect(await gh().ciConclusion("re-cinq/lore", "abc")).toBe("pending");
  });

  it("getInstallationToken returns the auth token", async () => {
    state.token = "ghs_installtoken";
    expect(await gh().getInstallationToken()).toBe("ghs_installtoken");
  });

  it("getInstallationToken for re-cinq/lore asks for a fresh token scoped to lore, never octokit's cached one", async () => {
    await gh().getInstallationToken("re-cinq/lore");

    expect(state.authCalls.at(-1)).toEqual({
      type: "installation",
      refresh: true,
      repositoryNames: ["lore"],
    });
  });

  it("createLabels swallows a 422 (already exists) and continues", async () => {
    state.labelError = { status: 422 };
    await expect(
      gh().createLabels("re-cinq/lore", [{ name: "x", color: "fff" }]),
    ).resolves.toBeUndefined();
  });

  it("createLabels rethrows a non-422 error", async () => {
    state.labelError = { status: 500 };
    await expect(
      gh().createLabels("re-cinq/lore", [{ name: "x", color: "fff" }]),
    ).rejects.toMatchObject({ status: 500 });
  });

  it("createReview posts one review with the mapped comments array", async () => {
    await gh().createReview("re-cinq/lore", 7, {
      event: "COMMENT",
      body: "### Lore review",
      comments: [
        { path: "a.ts", line: 12, body: "**nit:** rename" },
        { path: "b.ts", line: 3, side: "LEFT", body: "**issue:** null" },
      ],
    });

    expect(state.reviewCall).toMatchObject({
      owner: "re-cinq",
      repo: "lore",
      pull_number: 7,
      body: "### Lore review",
      event: "COMMENT",
      comments: [
        { path: "a.ts", line: 12, body: "**nit:** rename" },
        { path: "b.ts", line: 3, side: "LEFT", body: "**issue:** null" },
      ],
    });
  });

  it("get exposes the PR head sha as headSha", async () => {
    state.prData = {
      number: 7,
      title: "t",
      head: { ref: "feat/x", sha: "deadbeef" },
      state: "open",
      html_url: "https://gh/pr/7",
      user: { login: "bob" },
    };

    expect(await gh().get("re-cinq/lore", 7)).toMatchObject({
      headSha: "deadbeef",
      branch: "feat/x",
    });
  });

  it("listTree throws instead of returning a truncated tree", async () => {
    state.treeData = {
      truncated: true,
      tree: [{ type: "blob", path: "specs/a.md" }],
    };

    await expect(gh().listTree("re-cinq/lore", "main")).rejects.toThrow(
      new Error(
        "Recursive tree fetch for re-cinq/lore was truncated by GitHub — refusing to return a partial file list",
      ),
    );
  });

  it("listTree returns blob paths from a complete tree", async () => {
    state.treeData = {
      truncated: false,
      tree: [
        { type: "blob", path: "specs/a.md" },
        { type: "tree", path: "specs" },
      ],
    };

    expect(await gh().listTree("re-cinq/lore", "main")).toEqual(["specs/a.md"]);
  });
});

describe("PlatformGitHub review threads (GraphQL)", () => {
  const gh = () => new PlatformGitHub({ GITHUB_TOKEN: "gh-token" });

  beforeEach(() => {
    state.reviewThreadPages = [];
    state.graphqlCalls = [];
  });
  afterEach(() => vi.clearAllMocks());

  it("listReviewThreads maps nodes and stitches pages past the first cursor", async () => {
    state.reviewThreadPages = [
      {
        nodes: [
          {
            id: "PRRT_1",
            isResolved: false,
            isOutdated: false,
            comments: { nodes: [{ databaseId: 101 }, { databaseId: 102 }] },
          },
        ],
        pageInfo: { hasNextPage: true, endCursor: "cursor-1" },
      },
      {
        nodes: [
          {
            id: "PRRT_2",
            isResolved: true,
            isOutdated: true,
            comments: { nodes: [{ databaseId: null }] },
          },
        ],
        pageInfo: { hasNextPage: false, endCursor: null },
      },
    ];

    const threads = await gh().listReviewThreads("re-cinq/lore", 7);

    expect(threads).toEqual([
      {
        id: "PRRT_1",
        isResolved: false,
        isOutdated: false,
        comments: [{ databaseId: 101 }, { databaseId: 102 }],
      },
      {
        id: "PRRT_2",
        isResolved: true,
        isOutdated: true,
        comments: [{ databaseId: null }],
      },
    ]);
    expect(state.graphqlCalls[1]?.vars).toMatchObject({
      owner: "re-cinq",
      name: "lore",
      number: 7,
      cursor: "cursor-1",
    });
  });

  it("resolveReviewThread sends the mutation carrying the thread node id", async () => {
    await gh().resolveReviewThread("PRRT_42");

    expect(state.graphqlCalls).toHaveLength(1);
    expect(state.graphqlCalls[0]?.query).toContain("resolveReviewThread");
    expect(state.graphqlCalls[0]?.vars).toEqual({ threadId: "PRRT_42" });
  });

  it("open creates a draft pull request when asked for one", async () => {
    await gh().open("re-cinq/lore", "topic", {
      title: "T",
      body: "B",
      base: "main",
      labels: [],
      draft: true,
    });

    expect(state.createCall).toMatchObject({ draft: true });
  });

  it("open creates a ready pull request by default", async () => {
    await gh().open("re-cinq/lore", "topic", { title: "T", body: "B" });

    expect(state.createCall?.draft).toBeFalsy();
  });

  it("update rewrites the body of an existing pull request", async () => {
    await gh().update("re-cinq/lore", 7, { body: "rewritten" });

    expect(state.updateCall).toMatchObject({
      owner: "re-cinq",
      repo: "lore",
      pull_number: 7,
      body: "rewritten",
    });
  });

  it("close sets the pull request's state to closed", async () => {
    await gh().close("re-cinq/lore", 7);

    expect(state.updateCall).toEqual({
      owner: "re-cinq",
      repo: "lore",
      pull_number: 7,
      state: "closed",
    });
  });

  it("markReady sends the mutation carrying the pull request node id", async () => {
    state.prNode = { id: "PR_42", isDraft: true };

    await gh().markReady("re-cinq/lore", 7);

    expect(state.graphqlCalls).toHaveLength(2);
    expect(state.graphqlCalls[1]?.query).toContain(
      "markPullRequestReadyForReview",
    );
    expect(state.graphqlCalls[1]?.vars).toEqual({ pullRequestId: "PR_42" });
  });

  it("markReady sends no mutation for a pull request already out of draft", async () => {
    state.prNode = { id: "PR_42", isDraft: false };

    await gh().markReady("re-cinq/lore", 7);

    expect(state.graphqlCalls).toHaveLength(1);
  });

  it("markReady sends no mutation when the pull request cannot be read", async () => {
    state.prNode = undefined;

    await gh().markReady("re-cinq/lore", 7);

    expect(state.graphqlCalls).toHaveLength(1);
  });
});

describe("PlatformGitHub Actions job reads", () => {
  const gh = () => new PlatformGitHub({ GITHUB_TOKEN: "gh-token" });

  beforeEach(() => {
    state.checkRuns = [];
  });

  it("listChecks keeps each run's id and the app that published it, since an Actions run's id is its job id", async () => {
    state.checkRuns = [
      {
        id: 102930584180,
        app: { slug: "github-actions" },
        name: "build-test",
        status: "completed",
        conclusion: "failure",
        output: { title: null, summary: null },
      },
    ];
    expect(await gh().listChecks("re-cinq/bowman-ui", "f58642f4")).toEqual([
      {
        id: 102930584180,
        app: "github-actions",
        name: "build-test",
        status: "completed",
        conclusion: "failure",
        output: { title: null, summary: null },
      },
    ]);
  });
});

describe("PlatformGitHub failedJob", () => {
  const gh = () => new PlatformGitHub({ GITHUB_TOKEN: "gh-token" });

  beforeEach(() => {
    state.job = undefined;
    state.jobLog = undefined;
    state.jobError = undefined;
    state.annotations = undefined;
  });

  it("failedJob returns the failed step names and what the failing step printed", async () => {
    state.job = {
      steps: [
        { name: "Set up job", conclusion: "success" },
        { name: "Lint (--max-warnings 0)", conclusion: "failure" },
        { name: "Typecheck", conclusion: "skipped" },
      ],
    };
    state.jobLog = [
      "2026-09-10T15:19:24.9890197Z ##[endgroup]",
      "2026-09-10T15:19:33.0741174Z /home/runner/work/bowman-ui/bowman-ui/specs/bowman-ui-theming-tokens/spec.md",
      '2026-09-10T15:19:33.0771169Z ##[error]  6:1  error  Status "shipped" does not match',
      "2026-09-10T15:19:33.3498151Z ##[error]Process completed with exit code 1.",
    ].join("\n");
    expect(await gh().failedJob("re-cinq/bowman-ui", 102930584180)).toEqual({
      annotations: [],
      steps: ["Lint (--max-warnings 0)"],
      tail: [
        "/home/runner/work/bowman-ui/bowman-ui/specs/bowman-ui-theming-tokens/spec.md",
        '6:1  error  Status "shipped" does not match',
      ],
      unreadable: [],
    });
  });

  it("failedJob renders the check run's failure-level annotations as path:line message, dropping warnings", async () => {
    state.job = { steps: [{ name: "Lint", conclusion: "failure" }] };
    state.jobLog = "";
    state.annotations = [
      {
        path: "specs/web-ui-theming/spec.md",
        start_line: 60,
        annotation_level: "warning",
        message: "Testable statement has no test link",
      },
      {
        path: "specs/testing-standards/spec.md",
        start_line: 7,
        annotation_level: "failure",
        message:
          'Status "draft" does not match this spec\'s test-link coverage',
      },
    ];
    expect(await gh().failedJob("re-cinq/bowman-ui", 102930584180)).toEqual({
      annotations: [
        'specs/testing-standards/spec.md:7 Status "draft" does not match this spec\'s test-link coverage',
      ],
      steps: ["Lint"],
      tail: [],
      unreadable: [],
    });
  });
});

describe("PlatformGitHub failedJob when GitHub refuses", () => {
  const gh = () => new PlatformGitHub({ GITHUB_TOKEN: "gh-token" });

  beforeEach(() => {
    state.job = undefined;
    state.jobLog = undefined;
    state.jobError = undefined;
    state.annotations = undefined;
  });

  it("failedJob keeps the annotations and names the job and log reads GitHub refused with 403", async () => {
    state.jobError = { status: 403 };
    state.annotations = [
      {
        path: "apps/api/src/configuration/config.ts",
        start_line: 23,
        annotation_level: "failure",
        message: "Function 'getConfig' has too many lines (33)",
      },
    ];

    expect(await gh().failedJob("acme/widgets", 102930584180)).toEqual({
      annotations: [
        "apps/api/src/configuration/config.ts:23 Function 'getConfig' has too many lines (33)",
      ],
      steps: [],
      tail: [],
      unreadable: ["job (403)", "log (403)"],
    });
  });
});

describe("PlatformGitHub branch reads for the CI tools", () => {
  const gh = () => new PlatformGitHub({ GITHUB_TOKEN: "gh-token" });

  it("commitEmailOf returns the author email of the login's newest commit", async () => {
    state.branchCommits = [
      {
        sha: "a1",
        commit: {
          message: "feat",
          committer: null,
          author: { email: "bogdan@re-cinq.com" },
        },
      },
    ];

    expect(await gh().commitEmailOf("re-cinq/lore", "gedaiu")).toBe(
      "bogdan@re-cinq.com",
    );
  });

  it("commitEmailOf returns null for a login with no commits in the repo", async () => {
    state.branchCommits = [];

    expect(await gh().commitEmailOf("re-cinq/lore", "vvondruska")).toBe(null);
  });

  it("commitEmailOf returns null for a GitHub noreply address", async () => {
    state.branchCommits = [
      {
        sha: "a1",
        commit: {
          message: "feat",
          committer: null,
          author: { email: "123+gedaiu@users.noreply.github.com" },
        },
      },
    ];

    expect(await gh().commitEmailOf("re-cinq/lore", "gedaiu")).toBe(null);
  });

  it("listBranchCommits returns the branch's commits oldest-first, the order listCommits uses, so ciJudgedSha reads both alike", async () => {
    state.branchCommits = [
      {
        sha: "newest",
        commit: {
          message: "style: prettier [skip ci]",
          committer: { date: "2026-09-09T13:00:00Z" },
        },
      },
      {
        sha: "older",
        commit: { message: "feat: round 4", committer: null },
      },
    ];
    expect(await gh().listBranchCommits("re-cinq/lore", "topic", 30)).toEqual([
      { sha: "older", message: "feat: round 4", date: "" },
      {
        sha: "newest",
        message: "style: prettier [skip ci]",
        date: "2026-09-09T13:00:00Z",
      },
    ]);
  });

  it("jobLog returns the job's raw log", async () => {
    state.jobLog =
      "2026-09-09T13:06:58.1703793Z ##[error]    7:1  error  Status";
    state.jobError = undefined;
    expect(await gh().jobLog("re-cinq/lore", 102476456760)).toBe(
      "2026-09-09T13:06:58.1703793Z ##[error]    7:1  error  Status",
    );
  });

  it("jobLog returns null when GitHub has no such job (404)", async () => {
    state.jobError = { status: 404 };
    expect(await gh().jobLog("re-cinq/lore", 102476456760)).toBe(null);
  });

  it("jobLog rejects with GitHub's 403 when the log read is refused", async () => {
    state.jobError = { status: 403 };
    await expect(
      gh().jobLog("re-cinq/lore", 102476456760),
    ).rejects.toMatchObject({ status: 403 });
  });
});
