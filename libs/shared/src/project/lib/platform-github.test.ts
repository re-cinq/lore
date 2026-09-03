import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { PlatformGitHub } from "./platform-github.js";

const state: {
  files: Array<{ filename: string }>;
  checkRuns: Array<{ name: string; status: string; conclusion: string | null }>;
  token: string;
  labelError?: { status?: number };
  reviewCall?: Record<string, unknown>;
  prData?: Record<string, unknown>;
  treeData?: Record<string, unknown>;
  issuesData?: Array<Record<string, unknown>>;
  reviewThreadPages?: Array<Record<string, unknown>>;
  graphqlCalls: Array<{ query: string; vars: Record<string, unknown> }>;
  createCall?: Record<string, unknown>;
  updateCall?: Record<string, unknown>;
  prNode?: { id: string; isDraft: boolean };
} = { files: [], checkRuns: [], token: "", graphqlCalls: [] };

vi.mock("octokit", () => ({
  Octokit: class {
    hook = { before: () => {} };
    auth = async () => ({ token: state.token });
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
    paginate = async (
      fn: (p: unknown) => Promise<unknown[]>,
      params: unknown,
    ) => fn(params);
    rest = {
      pulls: {
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
      checks: { listForRef: async () => state.checkRuns },
      git: { getTree: async () => ({ data: state.treeData }) },
      issues: {
        addLabels: async () => ({}),
        listForRepo: async () => state.issuesData ?? [],
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
  });
  afterEach(() => vi.clearAllMocks());

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

  it("listFiles returns every changed filename (paginated past one page)", async () => {
    state.files = Array.from({ length: 31 }, (_, i) => ({
      filename: `src/f${i}.ts`,
    }));
    const files = await gh().listFiles("re-cinq/lore", 7);

    expect(files).toHaveLength(31);
    expect(files).toContain("src/f30.ts");
  });

  it("listChecks maps each run to name/status/conclusion", async () => {
    state.checkRuns = [
      { name: "build", status: "completed", conclusion: "success" },
    ];
    expect(await gh().listChecks("re-cinq/lore", "abc")).toEqual([
      { name: "build", status: "completed", conclusion: "success" },
    ]);
  });

  it("ciConclusion reports failure when any check failed", async () => {
    state.checkRuns = [
      { name: "a", status: "completed", conclusion: "success" },
      { name: "b", status: "completed", conclusion: "failure" },
    ];
    expect(await gh().ciConclusion("re-cinq/lore", "abc")).toBe("failure");
  });

  it("ciConclusion reports pending while a check is not completed", async () => {
    state.checkRuns = [{ name: "a", status: "in_progress", conclusion: null }];
    expect(await gh().ciConclusion("re-cinq/lore", "abc")).toBe("pending");
  });

  it("getInstallationToken returns the auth token", async () => {
    state.token = "ghs_installtoken";
    expect(await gh().getInstallationToken()).toBe("ghs_installtoken");
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
    await gh().open("re-cinq/lore", "topic", "T", "B", "main", [], true);

    expect(state.createCall).toMatchObject({ draft: true });
  });

  it("open creates a ready pull request by default", async () => {
    await gh().open("re-cinq/lore", "topic", "T", "B");

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
