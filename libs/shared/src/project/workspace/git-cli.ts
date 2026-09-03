import { enforceTrue } from "../../lib/enforce.js";
import { execFileSync } from "node:child_process";
import {
  mkdirSync,
  readFileSync,
  writeFileSync,
  rmSync,
  existsSync,
} from "node:fs";
import { dirname, join } from "node:path";
import type { GitPort, CloneOpts } from "./git-port.js";
import { gitAuthArgs, repoCloneUrl } from "./git-auth.js";

/**
 * GitPort over the local `git` binary — the same execSync idiom as
 * mcp-server/src/local-runner.ts, here behind the port. Auth rides in a
 * per-invocation `http.extraheader` (shared gitAuthArgs), never baked into the
 * clone URL or `.git/config`; a repo that already looks like a URL or path is
 * used as-is (lets integration tests clone a local bare repo without auth).
 */
export class GitCli implements GitPort {
  constructor(private readonly env: NodeJS.ProcessEnv = process.env) {}

  async clone(repo: string, destDir: string, opts?: CloneOpts): Promise<void> {
    const args = [...this.authArgs(), "clone"];

    if (opts?.ref) {
      args.push("--branch", opts.ref);
    }
    args.push(this.remoteUrl(repo), destDir);
    this.git(args);
  }

  async ensureClone(
    repo: string,
    destDir: string,
    opts?: CloneOpts,
  ): Promise<void> {
    // Reuse an existing clone (the /tmp cache) — fetch + checkout instead of
    // re-cloning, so a second run against the same cache dir is cheap and keeps
    // any local state. Only clone when the dir has no .git.
    if (!existsSync(join(destDir, ".git"))) {
      await this.clone(repo, destDir, opts);

      return;
    }
    this.git([...this.authArgs(), "fetch", "origin"], destDir);

    if (opts?.ref) {
      this.git(["checkout", opts.ref], destDir);
    }
  }

  async ensureCheckout(
    dir: string,
    branch?: string,
    commit?: string,
  ): Promise<void> {
    if (branch) {
      const current = this.git(
        ["rev-parse", "--abbrev-ref", "HEAD"],
        dir,
      ).trim();

      enforceTrue(
        !(current !== branch && this.isDirty(dir)),
        Error,
        `refusing to switch ${dir} to ${branch}: the working tree has uncommitted changes`,
      );
      this.git(["checkout", branch], dir);
    }

    if (commit) {
      this.git(["reset", "--hard", commit], dir);
    }
  }

  private isDirty(dir: string): boolean {
    return this.git(["status", "--porcelain"], dir).trim().length > 0;
  }

  async listBranches(dir: string): Promise<string[]> {
    const out = this.git(["branch", "--format=%(refname:short)"], dir);

    return out
      .split("\n")
      .map((b) => b.trim())
      .filter(Boolean);
  }

  async switchBranch(
    dir: string,
    branch: string,
    opts?: { create?: boolean },
  ): Promise<void> {
    this.git(
      opts?.create ? ["checkout", "-b", branch] : ["checkout", branch],
      dir,
    );
  }

  async readFile(dir: string, path: string): Promise<string> {
    return readFileSync(join(dir, path), "utf8");
  }

  async writeFile(dir: string, path: string, content: string): Promise<void> {
    const full = join(dir, path);

    mkdirSync(dirname(full), { recursive: true });
    writeFileSync(full, content);
  }

  async stageCommit(
    dir: string,
    message: string,
  ): Promise<{ committed: boolean }> {
    this.git(["add", "-A"], dir);
    const staged = this.git(["diff", "--cached", "--name-only"], dir).trim();

    if (!staged) {
      return { committed: false };
    }
    this.git(["commit", "-m", message], dir);

    return { committed: true };
  }

  async push(dir: string, branch: string): Promise<void> {
    this.git([...this.authArgs(), "push", "origin", branch], dir);
  }

  async remove(dir: string): Promise<void> {
    rmSync(dir, { recursive: true, force: true });
  }

  private git(args: string[], cwd?: string): string {
    // Forward the adapter's env so a configured identity reaches git, and default
    // committer/author to the Lore bot — git commits otherwise fail with "empty
    // ident name" wherever the ambient git config has no identity (CI, job pods).
    // Any GIT_AUTHOR_*/GIT_COMMITTER_* already in env overrides these defaults.
    const env = {
      GIT_AUTHOR_NAME: "Lore Agent",
      GIT_AUTHOR_EMAIL: "lore-agent@re-cinq.com",
      GIT_COMMITTER_NAME: "Lore Agent",
      GIT_COMMITTER_EMAIL: "lore-agent@re-cinq.com",
      ...this.env,
    };

    return execFileSync("git", args, { cwd, env, encoding: "utf8" });
  }

  private host(): string {
    return this.env.LORE_GIT_HOST ?? "github.com";
  }

  /** Per-invocation git auth args (http.extraheader) when a token is configured —
   *  keeps the token off disk. Empty when no token is set; harmless for a local
   *  bare-repo remote (the extraheader is scoped to the https host). */
  private authArgs(): string[] {
    const token = this.env.GITHUB_TOKEN ?? this.env.LORE_INGEST_TOKEN;

    return token ? gitAuthArgs(token, this.host()) : [];
  }

  private remoteUrl(repo: string): string {
    if (repo.includes("://") || repo.startsWith("/") || repo.startsWith(".")) {
      return repo;
    }

    return repoCloneUrl(repo, this.host());
  }
}
