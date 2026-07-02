import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { Octokit } from "octokit";
import { resolveDarkFactorySettings } from "@re-cinq/lore-shared";
import type { TaskPrInfo } from "@re-cinq/lore-shared/project/tasks/task-queue-port.js";
import {
  buildOctokit,
  resolvePrForTaskFromDb,
  type PrPolicyDeps,
  type PrInfoReader,
  type RepoSettingsReader,
} from "./pr-policy.js";

type TrustLevel = "docs" | "tests" | "implementation" | "full";

const settings = resolveDarkFactorySettings({ enabled: true });

/** A seeded task's PR coordinates. pr_number=null means "no PR yet". */
const task = (over: Partial<TaskPrInfo>): TaskPrInfo => ({
  target_repo: "re-cinq/lore",
  target_branch: "lore/x",
  pr_number: 7,
  ...over,
});

const prInfoReader = (info: TaskPrInfo): PrInfoReader => ({
  prInfo: async () => info,
});

const repoSettingsReader = (levels: Record<string, TrustLevel>): RepoSettingsReader => ({
  rawSettings: async (repo) => (levels[repo] ? { trust: { level: levels[repo] } } : null),
});

interface OctokitStub {
  files?: { filename: string }[];
  checkRuns?: { conclusion: string }[];
  reviews?: { state: string; user: { login: string } | null }[];
  throws?: boolean;
}

// Models GitHub's single-page REST calls (capped at `per_page`, default 30) vs
// octokit.paginate (all pages). The direct `rest.*` methods return only page 1;
// `paginate` returns the full set — so a policy read that forgets to paginate
// silently truncates the changed-file / check / review lists at 30.
const PAGE_SIZE = 30;

function makeOctokit(stub: OctokitStub): Octokit {
  const guard = () => {
    if (stub.throws) throw new Error("GitHub API down");
  };
  const listFiles = vi.fn(async () => {
    guard();
    return { data: (stub.files ?? []).slice(0, PAGE_SIZE) };
  });
  const listReviews = vi.fn(async () => {
    guard();
    return { data: (stub.reviews ?? []).slice(0, PAGE_SIZE) };
  });
  const listForRef = vi.fn(async () => {
    guard();
    return { data: { check_runs: (stub.checkRuns ?? []).slice(0, PAGE_SIZE) } };
  });
  const paginate = vi.fn(async (fn: unknown) => {
    guard();
    if (fn === listFiles) return stub.files ?? [];
    if (fn === listReviews) return stub.reviews ?? [];
    if (fn === listForRef) return stub.checkRuns ?? [];
    return [];
  });
  return {
    paginate,
    rest: { pulls: { listFiles, listReviews }, checks: { listForRef } },
  } as unknown as Octokit;
}

const deps = (info: TaskPrInfo, levels: Record<string, TrustLevel> = {}): PrPolicyDeps => ({
  tasks: prInfoReader(info),
  repos: repoSettingsReader(levels),
});

describe("resolvePrForTaskFromDb", () => {
  it("returns null when the task has no PR yet", async () => {
    const result = await resolvePrForTaskFromDb(
      "t1",
      settings,
      makeOctokit({}),
      deps(task({ pr_number: null })),
    );
    expect(result).toBeNull();
  });

  it("builds a passing policy from green CI, a bot approval, and repo trust", async () => {
    const result = await resolvePrForTaskFromDb(
      "t1",
      settings,
      makeOctokit({
        files: [{ filename: "docs/readme.md" }],
        checkRuns: [{ conclusion: "success" }, { conclusion: "skipped" }],
        reviews: [{ state: "APPROVED", user: { login: "lore-agent[bot]" } }],
      }),
      deps(task({}), { "re-cinq/lore": "implementation" }),
    );
    expect(result?.policy).toMatchObject({
      changedPaths: ["docs/readme.md"],
      ciSucceeded: true,
      botApproved: true,
      humanChangesRequested: false,
      trustLevel: "implementation",
    });
  });

  it("sees every changed file on a PR larger than one API page (auto-merge gate must not truncate)", async () => {
    const files = Array.from({ length: 31 }, (_, i) => ({ filename: `src/f${i}.ts` }));
    const result = await resolvePrForTaskFromDb(
      "t1",
      settings,
      makeOctokit({ files }),
      deps(task({})),
    );
    expect(result?.policy.changedPaths).toHaveLength(31);
    expect(result?.policy.changedPaths).toContain("src/f30.ts");
  });

  it("treats an empty check list as CI not succeeded", async () => {
    const result = await resolvePrForTaskFromDb(
      "t1",
      settings,
      makeOctokit({ checkRuns: [] }),
      deps(task({})),
    );
    expect(result?.policy.ciSucceeded).toBe(false);
  });

  it("treats any failing check as CI not succeeded", async () => {
    const result = await resolvePrForTaskFromDb(
      "t1",
      settings,
      makeOctokit({ checkRuns: [{ conclusion: "success" }, { conclusion: "failure" }] }),
      deps(task({})),
    );
    expect(result?.policy.ciSucceeded).toBe(false);
  });

  it("only counts an approval from the configured review bot", async () => {
    const result = await resolvePrForTaskFromDb(
      "t1",
      settings,
      makeOctokit({ reviews: [{ state: "APPROVED", user: { login: "dependabot[bot]" } }] }),
      deps(task({})),
    );
    expect(result?.policy.botApproved).toBe(false);
  });

  it("ignores a CHANGES_REQUESTED review authored by a bot", async () => {
    const result = await resolvePrForTaskFromDb(
      "t1",
      settings,
      makeOctokit({ reviews: [{ state: "CHANGES_REQUESTED", user: { login: "some-bot[bot]" } }] }),
      deps(task({})),
    );
    expect(result?.policy.humanChangesRequested).toBe(false);
  });

  it("flags a human CHANGES_REQUESTED review", async () => {
    const result = await resolvePrForTaskFromDb(
      "t1",
      settings,
      makeOctokit({ reviews: [{ state: "CHANGES_REQUESTED", user: { login: "alice" } }] }),
      deps(task({})),
    );
    expect(result?.policy.humanChangesRequested).toBe(true);
  });

  it("falls back to conservative defaults when the GitHub API throws", async () => {
    const result = await resolvePrForTaskFromDb(
      "t1",
      settings,
      makeOctokit({ throws: true }),
      deps(task({})),
    );
    expect(result?.policy).toMatchObject({
      changedPaths: [],
      ciSucceeded: false,
      botApproved: false,
      humanChangesRequested: false,
    });
  });
});

describe("buildOctokit", () => {
  const KEYS = [
    "GITHUB_APP_ID",
    "GITHUB_APP_PRIVATE_KEY",
    "GITHUB_APP_INSTALLATION_ID",
    "GITHUB_TOKEN",
  ] as const;
  const saved: Record<string, string | undefined> = {};

  beforeEach(() => {
    for (const k of KEYS) {
      saved[k] = process.env[k];
      delete process.env[k];
    }
  });

  afterEach(() => {
    for (const k of KEYS) {
      if (saved[k] === undefined) delete process.env[k];
      else process.env[k] = saved[k];
    }
  });

  it("builds from the GitHub App triplet", () => {
    process.env.GITHUB_APP_ID = "123";
    process.env.GITHUB_APP_PRIVATE_KEY = "key";
    process.env.GITHUB_APP_INSTALLATION_ID = "456";
    expect(buildOctokit()).toBeInstanceOf(Octokit);
  });

  it("falls back to a personal access token", () => {
    process.env.GITHUB_TOKEN = "ghp_token";
    expect(buildOctokit()).toBeInstanceOf(Octokit);
  });

  it("throws when no GitHub credentials are configured", () => {
    expect(() => buildOctokit()).toThrow(/GitHub not configured/);
  });
});
