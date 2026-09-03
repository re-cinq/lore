import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";

const rest = {
  repos: {
    get: vi.fn(),
    getContent: vi.fn(),
    createOrUpdateFileContents: vi.fn(),
  },
  git: {
    getRef: vi.fn(),
    createRef: vi.fn(),
  },
  pulls: {
    create: vi.fn(),
    list: vi.fn(),
  },
};

vi.mock("octokit", () => ({
  Octokit: vi.fn(function () {
    // `hook` is part of the real client, and the retry policy (#1017) installs a
    // request hook at construction — a fake without it models a client that does
    // not exist.
    return { rest, hook: { before: () => {} } };
  }),
}));
vi.mock("@octokit/auth-app", () => ({ createAppAuth: vi.fn() }));

import {
  computeStatus,
  isGitHubConfigured,
  getRepoFileContent,
  openIngestWorkflowPR,
  checkRepoAccess,
} from "./github";

const open = { merged: false, state: "open" as const };

describe("computeStatus", () => {
  it("returns merged when the PR is merged", () => {
    expect(computeStatus({ merged: true, state: "closed" }, [], [])).toBe(
      "merged",
    );
  });

  it("returns closed when the PR is closed without merge", () => {
    expect(computeStatus({ merged: false, state: "closed" }, [], [])).toBe(
      "closed",
    );
  });

  it("returns draft when the open PR is a draft", () => {
    expect(computeStatus({ ...open, draft: true }, [], [])).toBe("draft");
  });

  it("returns checks-failing when a check concluded failure", () => {
    expect(computeStatus(open, [{ conclusion: "failure" }], [])).toBe(
      "checks-failing",
    );
  });

  it("returns checks-failing when a check timed out", () => {
    expect(computeStatus(open, [{ conclusion: "timed_out" }], [])).toBe(
      "checks-failing",
    );
  });

  it("returns changes-requested when a review requested changes", () => {
    expect(
      computeStatus(
        open,
        [{ conclusion: "success" }],
        [{ state: "CHANGES_REQUESTED" }],
      ),
    ).toBe("changes-requested");
  });

  it("returns approved when approved and every check is success/skipped/null", () => {
    expect(
      computeStatus(
        open,
        [
          { conclusion: "success" },
          { conclusion: "skipped" },
          { conclusion: null },
        ],
        [{ state: "APPROVED" }],
      ),
    ).toBe("approved");
  });

  it("returns open when approved but a check is still pending", () => {
    expect(
      computeStatus(
        open,
        [{ conclusion: "action_required" }],
        [{ state: "APPROVED" }],
      ),
    ).toBe("open");
  });

  it("returns open when there are no checks and no reviews", () => {
    expect(computeStatus(open, [], [])).toBe("open");
  });

  it("returns checks-failing over changes-requested when both apply", () => {
    expect(
      computeStatus(
        open,
        [{ conclusion: "failure" }],
        [{ state: "CHANGES_REQUESTED" }],
      ),
    ).toBe("checks-failing");
  });
});

describe("isGitHubConfigured", () => {
  const keys = [
    "GITHUB_APP_ID",
    "GITHUB_APP_PRIVATE_KEY",
    "GITHUB_APP_INSTALLATION_ID",
  ] as const;
  let saved: Record<string, string | undefined>;

  beforeEach(() => {
    saved = Object.fromEntries(keys.map((k) => [k, process.env[k]]));
    keys.forEach((k) => delete process.env[k]);
  });

  afterEach(() => {
    keys.forEach((k) => {
      if (saved[k] === undefined) {
        delete process.env[k];

        return;
      }
      process.env[k] = saved[k];
    });
  });

  it("returns true when all three GitHub App vars are set", () => {
    keys.forEach((k) => (process.env[k] = "x"));
    expect(isGitHubConfigured()).toBe(true);
  });

  it("returns false when the installation id is missing", () => {
    process.env.GITHUB_APP_ID = "x";
    process.env.GITHUB_APP_PRIVATE_KEY = "x";
    expect(isGitHubConfigured()).toBe(false);
  });

  it("returns false when no vars are set", () => {
    expect(isGitHubConfigured()).toBe(false);
  });
});

const b64 = (s: string) => Buffer.from(s).toString("base64");
const httpError = (status: number) =>
  Object.assign(new Error(`HTTP ${status}`), { status });

function configureApp() {
  process.env.GITHUB_APP_ID = "id";
  process.env.GITHUB_APP_PRIVATE_KEY = "key";
  process.env.GITHUB_APP_INSTALLATION_ID = "inst";
}

function resetRest() {
  Object.values(rest).forEach((group) => {
    Object.values(group).forEach((fn) => fn.mockReset());
  });
}

describe("getRepoFileContent", () => {
  beforeEach(() => {
    configureApp();
    resetRest();
  });

  it("returns the decoded file content", async () => {
    rest.repos.getContent.mockResolvedValue({
      data: { type: "file", content: b64("hello world") },
    });

    const out = await getRepoFileContent("re-cinq/app", "path/to.yml");

    expect(out).toBe("hello world");
    expect(rest.repos.getContent).toHaveBeenCalledWith({
      owner: "re-cinq",
      repo: "app",
      path: "path/to.yml",
    });
  });

  it("returns null on a 404", async () => {
    rest.repos.getContent.mockRejectedValue(httpError(404));
    expect(await getRepoFileContent("re-cinq/app", "missing.yml")).toBeNull();
  });

  it("rethrows a 403 rate-limit so callers fail soft instead of reading it as absent", async () => {
    rest.repos.getContent.mockRejectedValue(httpError(403));
    await expect(
      getRepoFileContent("re-cinq/app", "present.yml"),
    ).rejects.toThrow("HTTP 403");
  });

  it("rethrows a 500 instead of returning null", async () => {
    rest.repos.getContent.mockRejectedValue(httpError(500));
    await expect(
      getRepoFileContent("re-cinq/app", "present.yml"),
    ).rejects.toThrow("HTTP 500");
  });

  it("returns null when the path is a directory", async () => {
    rest.repos.getContent.mockResolvedValue({ data: [{ type: "file" }] });
    expect(await getRepoFileContent("re-cinq/app", "dir")).toBeNull();
  });

  it("returns null without calling GitHub when the App is not configured", async () => {
    delete process.env.GITHUB_APP_ID;
    expect(await getRepoFileContent("re-cinq/app", "x.yml")).toBeNull();
    expect(rest.repos.getContent).not.toHaveBeenCalled();
  });
});

describe("openIngestWorkflowPR", () => {
  beforeEach(() => {
    configureApp();
    resetRest();
  });

  const happyPath = () => {
    rest.repos.get.mockResolvedValue({ data: { default_branch: "main" } });
    rest.git.getRef.mockResolvedValue({ data: { object: { sha: "basesha" } } });
    rest.git.createRef.mockResolvedValue({});
    rest.repos.createOrUpdateFileContents.mockResolvedValue({});
    rest.pulls.create.mockResolvedValue({
      data: { html_url: "https://gh/pr/1", number: 1 },
    });
  };

  it("creates a branch, commits the file, and opens a PR against the default branch", async () => {
    happyPath();
    rest.repos.getContent.mockRejectedValue(httpError(404)); // file not yet on the branch

    const out = await openIngestWorkflowPR(
      "re-cinq/app",
      ".github/workflows/lore-ingest.yml",
      "CONTENT",
    );

    expect(out).toEqual({ url: "https://gh/pr/1", number: 1 });
    expect(rest.git.createRef).toHaveBeenCalledWith({
      owner: "re-cinq",
      repo: "app",
      ref: "refs/heads/lore/fix-ingest-workflow",
      sha: "basesha",
    });
    expect(rest.repos.createOrUpdateFileContents).toHaveBeenCalledWith(
      expect.objectContaining({
        owner: "re-cinq",
        repo: "app",
        path: ".github/workflows/lore-ingest.yml",
        branch: "lore/fix-ingest-workflow",
        content: b64("CONTENT"),
      }),
    );
    expect(
      rest.repos.createOrUpdateFileContents.mock.calls[0][0].sha,
    ).toBeUndefined();
    expect(rest.pulls.create).toHaveBeenCalledWith(
      expect.objectContaining({
        head: "lore/fix-ingest-workflow",
        base: "main",
      }),
    );
  });

  it("upserts with the existing blob sha when the file is already on the branch", async () => {
    happyPath();
    rest.repos.getContent.mockResolvedValue({
      data: { type: "file", sha: "oldsha" },
    });

    await openIngestWorkflowPR(
      "re-cinq/app",
      ".github/workflows/lore-ingest.yml",
      "CONTENT",
    );

    expect(rest.repos.createOrUpdateFileContents.mock.calls[0][0].sha).toBe(
      "oldsha",
    );
  });

  it("reuses an existing branch when createRef reports it already exists", async () => {
    happyPath();
    rest.git.createRef.mockRejectedValue(httpError(422));
    rest.repos.getContent.mockRejectedValue(httpError(404));

    const out = await openIngestWorkflowPR("re-cinq/app", "p.yml", "CONTENT");

    expect(out).toEqual({ url: "https://gh/pr/1", number: 1 });
    expect(rest.repos.createOrUpdateFileContents).toHaveBeenCalled();
  });

  it("returns the existing open PR when one is already open for the branch", async () => {
    happyPath();
    rest.repos.getContent.mockRejectedValue(httpError(404));
    rest.pulls.create.mockRejectedValue(httpError(422));
    rest.pulls.list.mockResolvedValue({
      data: [{ html_url: "https://gh/pr/9", number: 9 }],
    });

    const out = await openIngestWorkflowPR("re-cinq/app", "p.yml", "CONTENT");

    expect(out).toEqual({ url: "https://gh/pr/9", number: 9 });
    expect(rest.pulls.list).toHaveBeenCalledWith(
      expect.objectContaining({
        head: "re-cinq:lore/fix-ingest-workflow",
        state: "open",
      }),
    );
  });

  it("rethrows a non-422 createRef failure", async () => {
    happyPath();
    rest.git.createRef.mockRejectedValue(httpError(500));

    await expect(
      openIngestWorkflowPR("re-cinq/app", "p.yml", "CONTENT"),
    ).rejects.toThrow("HTTP 500");
  });

  it("returns null without touching GitHub when the App is not configured", async () => {
    delete process.env.GITHUB_APP_PRIVATE_KEY;
    expect(
      await openIngestWorkflowPR("re-cinq/app", "p.yml", "CONTENT"),
    ).toBeNull();
    expect(rest.repos.get).not.toHaveBeenCalled();
  });
});

describe("checkRepoAccess", () => {
  beforeEach(() => {
    configureApp();
    resetRest();
  });

  it("returns ok when the App can fetch the repo", async () => {
    rest.repos.get.mockResolvedValue({ data: { full_name: "re-cinq/app" } });
    expect(await checkRepoAccess("re-cinq/app")).toBe("ok");
    expect(rest.repos.get).toHaveBeenCalledWith({
      owner: "re-cinq",
      repo: "app",
    });
  });

  it("returns not-found when GitHub answers 404", async () => {
    rest.repos.get.mockRejectedValue(httpError(404));
    expect(await checkRepoAccess("wrong-owner/app")).toBe("not-found");
  });

  it("returns unknown on a transient GitHub error", async () => {
    rest.repos.get.mockRejectedValue(httpError(500));
    expect(await checkRepoAccess("re-cinq/app")).toBe("unknown");
  });

  it("returns unknown without touching GitHub when the App is not configured", async () => {
    delete process.env.GITHUB_APP_PRIVATE_KEY;
    expect(await checkRepoAccess("re-cinq/app")).toBe("unknown");
    expect(rest.repos.get).not.toHaveBeenCalled();
  });
});
