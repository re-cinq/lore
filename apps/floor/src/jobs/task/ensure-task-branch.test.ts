import { describe, it, expect } from "vitest";
import { ensureTaskBranch } from "./ensure-task-branch.js";

/** A repo double recording what the Floor asked of it. `exists` undefined models an
 *  adapter that cannot answer (the station HTTP shim). */
function repoDouble(exists: boolean | undefined) {
  const created: { branch: string; base?: string }[] = [];

  return {
    created,
    repo: {
      branchExists: () =>
        exists === undefined ? undefined : Promise.resolve(exists),
      createBranch: async (branch: string, base?: string) => {
        created.push({ branch, base });
      },
      defaultBranch: async () => "main",
    },
  };
}

describe("ensureTaskBranch", () => {
  it("creates the branch off the default branch when it does not exist", async () => {
    const { repo, created } = repoDouble(false);

    await ensureTaskBranch(repo, "lore/feature-planning/live-view-ec914872");

    expect(created).toEqual([
      { branch: "lore/feature-planning/live-view-ec914872", base: "main" },
    ]);
  });

  it("leaves an existing branch untouched so a revision keeps its commits", async () => {
    const { repo, created } = repoDouble(true);

    await ensureTaskBranch(repo, "lore/implementation/resume-me");

    expect(created).toEqual([]);
  });

  it("creates nothing when the adapter cannot report existence", async () => {
    const { repo, created } = repoDouble(undefined);

    await ensureTaskBranch(repo, "lore/implementation/unknown");

    expect(created).toEqual([]);
  });

  it("does not fail the dispatch when the existence probe throws", async () => {
    const created: { branch: string; base?: string }[] = [];
    const repo = {
      branchExists: () => Promise.reject(new Error("GitHub 500")),
      createBranch: async (branch: string, base?: string) => {
        created.push({ branch, base });
      },
      defaultBranch: async () => "main",
    };

    await expect(
      ensureTaskBranch(repo, "lore/implementation/flaky"),
    ).resolves.toBeUndefined();
    expect(created).toEqual([]);
  });

  it("surfaces a creation failure rather than dispatching a pod that cannot check out", async () => {
    const repo = {
      branchExists: () => Promise.resolve(false),
      createBranch: async () => {
        throw new Error("branch protection");
      },
      defaultBranch: async () => "main",
    };

    await expect(ensureTaskBranch(repo, "lore/general/x")).rejects.toThrow(
      new Error("branch protection"),
    );
  });
});
