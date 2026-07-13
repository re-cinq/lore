import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { execFileSync } from "node:child_process";
import { mkdtempSync, rmSync, writeFileSync, existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { GitCli } from "./git-cli.js";

/**
 * GitCli against a REAL local bare repo — the integration counterpart to the
 * Workspace unit test. No network/auth: a temp bare repo is the remote. Skips
 * when git is unavailable.
 */

function gitAvailable(): boolean {
  try {
    execFileSync("git", ["--version"]);
    return true;
  } catch {
    return false;
  }
}

const hasGit = gitAvailable();
const IDENTITY = {
  GIT_AUTHOR_NAME: "t",
  GIT_AUTHOR_EMAIL: "t@t",
  GIT_COMMITTER_NAME: "t",
  GIT_COMMITTER_EMAIL: "t@t",
};

describe.skipIf(!hasGit)("GitCli (live git)", () => {
  let base: string;
  let bare: string;
  const env = { ...process.env, ...IDENTITY };

  beforeAll(() => {
    base = mkdtempSync(join(tmpdir(), "gitcli-"));
    bare = join(base, "origin.git");
    execFileSync("git", ["init", "--bare", "-b", "main", bare]);
    const seed = join(base, "seed");
    execFileSync("git", ["clone", bare, seed], { env });
    execFileSync("git", ["-C", seed, "checkout", "-b", "main"], { env });
    execFileSync("bash", ["-c", `echo '# Seed' > "${seed}/README.md"`]);
    execFileSync("git", ["-C", seed, "add", "-A"], { env });
    execFileSync("git", ["-C", seed, "commit", "-m", "seed"], { env });
    execFileSync("git", ["-C", seed, "push", "-u", "origin", "main"], { env });
  });

  afterAll(() => rmSync(base, { recursive: true, force: true }));

  it("clones the remote and reads a seeded file", async () => {
    const git = new GitCli(env);
    const dest = join(base, "clone-a");

    await git.clone(bare, dest);

    expect(await git.readFile(dest, "README.md")).toBe("# Seed\n");
    expect(await git.listBranches(dest)).toContain("main");
  });

  it("writes, commits on a new branch, and pushes to the remote", async () => {
    const git = new GitCli(env);
    const dest = join(base, "clone-b");
    await git.clone(bare, dest);

    await git.switchBranch(dest, "feat", { create: true });
    await git.writeFile(dest, "docs/note.md", "hello");
    const result = await git.stageCommit(dest, "docs: note");
    await git.push(dest, "feat");

    expect(result).toEqual({ committed: true });
    expect(
      execFileSync("git", ["ls-remote", "--heads", bare], { encoding: "utf8" }),
    ).toContain("refs/heads/feat");
  });

  it("commits with the Lore Agent identity when the environment provides none", async () => {
    const git = new GitCli({ PATH: process.env.PATH, HOME: process.env.HOME });
    const dest = join(base, "clone-id");
    await git.clone(bare, dest);

    await git.switchBranch(dest, "feat-id", { create: true });
    await git.writeFile(dest, "id.md", "x");
    await git.stageCommit(dest, "id: commit");

    const author = execFileSync(
      "git",
      ["-C", dest, "log", "-1", "--format=%an <%ae>"],
      { encoding: "utf8" },
    ).trim();
    expect(author).toBe("Lore Agent <lore-agent@re-cinq.com>");
  });

  it("ensureClone clones when absent, then reuses the cache (fetch, not re-clone) on the second call", async () => {
    const git = new GitCli(env);
    const dest = join(base, "cache-x");

    await git.ensureClone(bare, dest);
    // An untracked marker survives a fetch+checkout reuse, but not a re-clone.
    writeFileSync(join(dest, "MARKER"), "keep");
    await git.ensureClone(bare, dest);

    expect(existsSync(join(dest, "MARKER"))).toBe(true);
  });

  it("ensureCheckout pins the working tree to a branch", async () => {
    const git = new GitCli(env);
    const dest = join(base, "cache-co");
    await git.ensureClone(bare, dest);
    execFileSync("git", ["-C", dest, "branch", "pinned"], { env });

    await git.ensureCheckout(dest, "pinned");

    const branch = execFileSync(
      "git",
      ["-C", dest, "rev-parse", "--abbrev-ref", "HEAD"],
      { encoding: "utf8" },
    ).trim();
    expect(branch).toBe("pinned");
  });

  it("ensureCheckout refuses to switch a dirty working tree", async () => {
    const git = new GitCli(env);
    const dest = join(base, "cache-dirty");
    await git.ensureClone(bare, dest);
    execFileSync("git", ["-C", dest, "branch", "other"], { env });
    writeFileSync(join(dest, "README.md"), "uncommitted edit");

    await expect(git.ensureCheckout(dest, "other")).rejects.toThrow(
      /uncommitted/,
    );
  });
});
