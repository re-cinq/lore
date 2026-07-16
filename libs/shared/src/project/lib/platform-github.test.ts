import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { PlatformGitHub } from "./platform-github.js";

/**
 * The auth resolution (relocated from github-client.ts) without network: with
 * no App creds and no token, any call fails with the clear config error. Real
 * env values drive it — no mocks. Authenticated REST behavior is integration.
 */

// The `{}`-env auth tests below throw from the config check before any REST call,
// so mocking octokit doesn't disturb them; the paginated-read suite uses it.
const state: {
  files: Array<{ filename: string }>;
  checkRuns: Array<{ name: string; status: string; conclusion: string | null }>;
  token: string;
  labelError?: { status?: number };
  reviewCall?: Record<string, unknown>;
  prData?: Record<string, unknown>;
} = { files: [], checkRuns: [], token: "" };

vi.mock("octokit", () => ({
  Octokit: class {
    auth = async () => ({ token: state.token });
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
      },
      checks: { listForRef: async () => state.checkRuns },
      issues: {
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
  });
  afterEach(() => vi.clearAllMocks());

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
});
