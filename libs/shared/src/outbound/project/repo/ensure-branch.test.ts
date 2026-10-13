import { describe, expect, it } from "vitest";
import { ensureBranch, type BranchRepo } from "./ensure-branch.js";

type Existence = () => Promise<boolean> | undefined;

const missing: Existence = async () => false;
const present: Existence = async () => true;
const unknown: Existence = () => undefined;

function repoWhere(branchExists: Existence) {
  const created: string[] = [];
  const repo: BranchRepo = {
    branchExists,
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
    const { repo, created } = repoWhere(missing);

    await ensureBranch(repo, "lore/x");

    expect(created).toEqual(["lore/x from develop"]);
  });

  it("creates nothing when lore/x exists", async () => {
    const { repo, created } = repoWhere(present);

    await ensureBranch(repo, "lore/x");

    expect(created).toEqual([]);
  });

  it("creates nothing when the port cannot say whether lore/x exists", async () => {
    const { repo, created } = repoWhere(unknown);

    await ensureBranch(repo, "lore/x");

    expect(created).toEqual([]);
  });
});
