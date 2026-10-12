import { describe, expect, it } from "vitest";
import {
  ensureSpecBranch,
  specBranchOf,
  type SpecBranchRepo,
} from "./spec-branch.js";

class InMemoryBranches implements SpecBranchRepo {
  readonly created: Array<{ branch: string; base?: string }> = [];

  constructor(private readonly existing: readonly string[]) {}

  branchExists(branch: string): Promise<boolean> | undefined {
    return Promise.resolve(this.existing.includes(branch));
  }

  createBranch(branch: string, base?: string): Promise<void> {
    this.created.push({ branch, base });

    return Promise.resolve();
  }

  defaultBranch(): Promise<string> {
    return Promise.resolve("trunk");
  }
}

class SilentBranches extends InMemoryBranches {
  override branchExists(): undefined {
    return undefined;
  }
}

describe("specBranchOf", () => {
  it("names lore/feature-planning/p1 for plan p1, whatever its title becomes", () => {
    expect(specBranchOf({ id: "p1" })).toBe("lore/feature-planning/p1");
  });
});

describe("ensureSpecBranch", () => {
  it("cuts lore/feature-planning/p1 from the default branch trunk when it does not exist", async () => {
    const repo = new InMemoryBranches([]);

    const branch = await ensureSpecBranch(repo, { id: "p1" });

    expect(branch).toBe("lore/feature-planning/p1");
    expect(repo.created).toEqual([
      { branch: "lore/feature-planning/p1", base: "trunk" },
    ]);
  });

  it("leaves an existing lore/feature-planning/p1 alone, so the commits its spec PR holds survive", async () => {
    const repo = new InMemoryBranches(["lore/feature-planning/p1"]);

    await ensureSpecBranch(repo, { id: "p1" });

    expect(repo.created).toEqual([]);
  });

  it("leaves the branch alone when the repo cannot say whether it exists", async () => {
    const repo = new SilentBranches([]);

    await ensureSpecBranch(repo, { id: "p1" });

    expect(repo.created).toEqual([]);
  });
});
