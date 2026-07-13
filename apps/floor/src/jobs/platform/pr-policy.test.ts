import { enforceTrue } from "@re-cinq/lore-shared/lib/enforce.js";
import { describe, it, expect } from "vitest";
import { resolveDarkFactorySettings } from "@re-cinq/lore-shared";
import type { PullRequests } from "@re-cinq/lore-shared/project/pulls/pull-requests.js";
import type { TaskPrInfo } from "@re-cinq/lore-shared/project/tasks/task-queue-port.js";
import {
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

const repoSettingsReader = (
  levels: Record<string, TrustLevel>,
): RepoSettingsReader => ({
  rawSettings: async (repo) =>
    levels[repo] ? { trust: { level: levels[repo] } } : null,
});

interface PullsStub {
  files?: string[];
  checkRuns?: Array<{
    name: string;
    status: string;
    conclusion: string | null;
  }>;
  reviews?: Array<{ state: string; user: string }>;
  throws?: boolean;
}

// pr-policy reads PR state through project.pulls (paginated inside the shared
// adapter — see platform-github.test.ts). Here we fake the facade to drive the
// gate inputs; a thrown read must leave the conservative defaults.
function pullsFor(stub: PullsStub): (repo: string) => Promise<PullRequests> {
  const guard = () => {
    enforceTrue(!stub.throws, new Error("GitHub API down"));
  };
  const facade = {
    listFiles: async () => {
      guard();
      return stub.files ?? [];
    },
    listChecks: async () => {
      guard();
      return stub.checkRuns ?? [];
    },
    listReviews: async () => {
      guard();
      return (stub.reviews ?? []).map((r, i) => ({
        id: i,
        state: r.state,
        body: "",
        user: r.user,
        submitted_at: "",
      }));
    },
  } as unknown as PullRequests;
  return async () => facade;
}

const deps = (
  info: TaskPrInfo,
  stub: PullsStub,
  levels: Record<string, TrustLevel> = {},
): PrPolicyDeps => ({
  tasks: prInfoReader(info),
  repos: repoSettingsReader(levels),
  pullsFor: pullsFor(stub),
});

describe("resolvePrForTaskFromDb", () => {
  it("returns null when the task has no PR yet", async () => {
    const result = await resolvePrForTaskFromDb(
      "t1",
      settings,
      deps(task({ pr_number: null }), {}),
    );
    expect(result).toBeNull();
  });

  it("builds a passing policy from green CI, a bot approval, and repo trust", async () => {
    const result = await resolvePrForTaskFromDb(
      "t1",
      settings,
      deps(
        task({}),
        {
          files: ["docs/readme.md"],
          checkRuns: [
            { name: "a", status: "completed", conclusion: "success" },
            { name: "b", status: "completed", conclusion: "skipped" },
          ],
          reviews: [{ state: "APPROVED", user: "lore-agent[bot]" }],
        },
        { "re-cinq/lore": "implementation" },
      ),
    );
    expect(result?.policy).toMatchObject({
      changedPaths: ["docs/readme.md"],
      ciSucceeded: true,
      botApproved: true,
      humanChangesRequested: false,
      trustLevel: "implementation",
    });
  });

  it("passes every changed path through from the (paginated) facade", async () => {
    const files = Array.from({ length: 31 }, (_, i) => `src/f${i}.ts`);
    const result = await resolvePrForTaskFromDb(
      "t1",
      settings,
      deps(task({}), { files }),
    );
    expect(result?.policy.changedPaths).toHaveLength(31);
    expect(result?.policy.changedPaths).toContain("src/f30.ts");
  });

  it("treats an empty check list as CI not succeeded", async () => {
    const result = await resolvePrForTaskFromDb(
      "t1",
      settings,
      deps(task({}), { checkRuns: [] }),
    );
    expect(result?.policy.ciSucceeded).toBe(false);
  });

  it("treats any failing check as CI not succeeded", async () => {
    const result = await resolvePrForTaskFromDb(
      "t1",
      settings,
      deps(task({}), {
        checkRuns: [
          { name: "a", status: "completed", conclusion: "success" },
          { name: "b", status: "completed", conclusion: "failure" },
        ],
      }),
    );
    expect(result?.policy.ciSucceeded).toBe(false);
  });

  it("only counts an approval from the configured review bot", async () => {
    const result = await resolvePrForTaskFromDb(
      "t1",
      settings,
      deps(task({}), {
        reviews: [{ state: "APPROVED", user: "dependabot[bot]" }],
      }),
    );
    expect(result?.policy.botApproved).toBe(false);
  });

  it("ignores a CHANGES_REQUESTED review authored by a bot", async () => {
    const result = await resolvePrForTaskFromDb(
      "t1",
      settings,
      deps(task({}), {
        reviews: [{ state: "CHANGES_REQUESTED", user: "some-bot[bot]" }],
      }),
    );
    expect(result?.policy.humanChangesRequested).toBe(false);
  });

  it("flags a human CHANGES_REQUESTED review", async () => {
    const result = await resolvePrForTaskFromDb(
      "t1",
      settings,
      deps(task({}), {
        reviews: [{ state: "CHANGES_REQUESTED", user: "alice" }],
      }),
    );
    expect(result?.policy.humanChangesRequested).toBe(true);
  });

  it("falls back to conservative defaults when the PR read throws", async () => {
    const result = await resolvePrForTaskFromDb(
      "t1",
      settings,
      deps(task({}), { throws: true }),
    );
    expect(result?.policy).toMatchObject({
      changedPaths: [],
      ciSucceeded: false,
      botApproved: false,
      humanChangesRequested: false,
    });
  });
});
