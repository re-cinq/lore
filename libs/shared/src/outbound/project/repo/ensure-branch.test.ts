import { describe, expect, it } from "vitest";
import { ensureBranch, type BranchRepo } from "./ensure-branch.js";

function repoWhere(exists: boolean | undefined) {
  const created: string[] = [];
  const repo: BranchRepo = {
    branchExists: () =>
      exists === undefined ? undefined : Promise.resolve(exists),
    createBranch: (branch, base) => {
      created.push(`${branch} from ${base}`);

      return Promise.resolve();
    },
    defaultBranch: () => Promise.resolve("develop"),
  };

  return { repo, created };
}

describe("ensureBranch", () => {
  it("cuts lore/x from the default branch develop when it is missing", async () => {
    const { repo, created } = repoWhere(false);

    await ensureBranch(repo, "lore/x");

    expect(created).toEqual(["lore/x from develop"]);
  });

  it("creates nothing when lore/x exists", async () => {
    const { repo, created } = repoWhere(true);

    await ensureBranch(repo, "lore/x");

    expect(created).toEqual([]);
  });

  it("creates nothing when the port cannot say whether lore/x exists", async () => {
    const { repo, created } = repoWhere(undefined);

    await ensureBranch(repo, "lore/x");

    expect(created).toEqual([]);
  });
});
