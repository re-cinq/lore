import { describe, it, expect } from "vitest";
import { enforceTrue } from "@re-cinq/lore-shared/lib/enforce.js";
import { InMemorySettings } from "@re-cinq/lore-shared/project/settings/settings-memory.js";
import { Settings } from "@re-cinq/lore-shared/project/settings/settings.js";
import {
  parseOnboardingPrUrl,
  sweepOnboardingRepos,
  type OnboardingSweepDeps,
} from "./merge-check.js";

describe("parseOnboardingPrUrl", () => {
  it("reads owner, repo, and PR number from a github.com pull URL", () => {
    expect(
      parseOnboardingPrUrl("https://github.com/acme/widgets/pull/42"),
    ).toEqual({ owner: "acme", repoName: "widgets", number: 42 });
  });

  it("returns null for a URL that carries no pull request", () => {
    expect(parseOnboardingPrUrl("https://github.com/acme/widgets")).toBeNull();
  });

  it("returns null for an empty string", () => {
    expect(parseOnboardingPrUrl("")).toBeNull();
  });
});

describe("parseOnboardingPrUrl on host ghe.example.com", () => {
  it("reads owner, repo, and PR number from https://ghe.example.com/acme/widgets/pull/42", () => {
    expect(
      parseOnboardingPrUrl(
        "https://ghe.example.com/acme/widgets/pull/42",
        "ghe.example.com",
      ),
    ).toEqual({ owner: "acme", repoName: "widgets", number: 42 });
  });

  it("returns null for https://github.com/acme/widgets/pull/42", () => {
    expect(
      parseOnboardingPrUrl(
        "https://github.com/acme/widgets/pull/42",
        "ghe.example.com",
      ),
    ).toBeNull();
  });
});

describe("sweepOnboardingRepos", () => {
  const MERGED_REPO = {
    id: "repo-1",
    full_name: "re-cinq/app",
    onboarding_pr_url: "https://github.com/re-cinq/app/pull/42",
  };
  const OTHER_REPO = {
    id: "repo-2",
    full_name: "re-cinq/other",
    onboarding_pr_url: "https://github.com/re-cinq/other/pull/7",
  };

  function sweepScene(
    port: InMemorySettings,
    defaultBranch: () => Promise<string>,
  ) {
    const marked: string[] = [];
    const deps: OnboardingSweepDeps = {
      projectFor: async (repo) => ({
        pulls: {
          isMerged: async () => true,
          isClosed: async () => false,
        },
        repo: { defaultBranch },
        settings: new Settings(repo, port),
      }),
      markOnboardingMerged: async (id) => {
        marked.push(id);
      },
      clearOnboardingPrUrl: async () => {},
    };

    return { deps, marked };
  }

  it("dispatches lore-ingest.yml and lore-tests.yml on main when re-cinq/app's onboarding PR merged", async () => {
    const port = new InMemorySettings();

    port.workflowStates.set("re-cinq/app/lore-ingest.yml", "active");
    port.workflowStates.set("re-cinq/app/lore-tests.yml", "active");
    const { deps, marked } = sweepScene(port, async () => "main");

    expect(await sweepOnboardingRepos([MERGED_REPO], deps)).toBe(1);
    expect(marked).toEqual(["repo-1"]);
    expect(port.dispatchedWorkflows).toEqual([
      { repo: "re-cinq/app", file: "lore-ingest.yml", ref: "main" },
      { repo: "re-cinq/app", file: "lore-tests.yml", ref: "main" },
    ]);
  });

  it("dispatches re-cinq/other's workflows and counts both merged when re-cinq/app's default branch cannot be read", async () => {
    const port = new InMemorySettings();

    port.workflowStates.set("re-cinq/other/lore-ingest.yml", "active");
    port.workflowStates.set("re-cinq/other/lore-tests.yml", "active");
    let reads = 0;
    const { deps } = sweepScene(port, async () => {
      reads++;
      enforceTrue(reads > 1, Error, "branch lookup failed");

      return "main";
    });

    expect(await sweepOnboardingRepos([MERGED_REPO, OTHER_REPO], deps)).toBe(2);
    expect(port.dispatchedWorkflows).toEqual([
      { repo: "re-cinq/other", file: "lore-ingest.yml", ref: "main" },
      { repo: "re-cinq/other", file: "lore-tests.yml", ref: "main" },
    ]);
  });
});
