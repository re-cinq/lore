import { execFile } from "node:child_process";
import { existsSync, mkdirSync } from "node:fs";
import { join } from "node:path";
import { promisify } from "node:util";
import { enforceTrue } from "../../../lib/enforce.js";

const execFileAsync = promisify(execFile);
const GIT_TIMEOUT_MS = 5 * 60 * 1000;
const NOT_AN_ANCESTOR_EXIT_CODE = 1;
const SAFE_PACK_ARGS = ["-c", "pack.threads=1", "-c", "pack.windowMemory=64m"];

interface GitResult {
  exitCode: number;
  stdout: string;
  stderr: string;
}

export interface GitRun {
  authArgs?: string[];
}

/** Runs git inside one bare cache directory with no prompts, a timeout and the token redacted from every failure. */
export class MirrorGitRunner {
  constructor(
    readonly cacheDir: string,
    private readonly env: NodeJS.ProcessEnv = process.env,
  ) {}

  async ensureCache(): Promise<void> {
    if (existsSync(join(this.cacheDir, "HEAD"))) {
      return;
    }
    mkdirSync(this.cacheDir, { recursive: true });
    await this.git(["init", "--bare", "--quiet"]);
  }

  /** Fetches `ref` of `url` and answers the sha it points at. */
  async fetchHead(
    url: string,
    authArgs: string[],
    ref: string,
  ): Promise<string> {
    await this.git(["fetch", "--no-tags", url, ref], { authArgs });

    return this.git(["rev-parse", "FETCH_HEAD"]);
  }

  async remoteRef(
    url: string,
    authArgs: string[],
    ref: string,
  ): Promise<string | null> {
    const listing = await this.git(["ls-remote", url, ref], { authArgs });

    return listing.split("\t")[0] || null;
  }

  async isAncestor(ancestor: string, descendant: string): Promise<boolean> {
    const exitCode = await this.exitCodeOf([
      "merge-base",
      "--is-ancestor",
      ancestor,
      descendant,
    ]);

    enforceTrue(
      exitCode === 0 || exitCode === NOT_AN_ANCESTOR_EXIT_CODE,
      Error,
      `git merge-base failed with exit code ${exitCode}`,
    );

    return exitCode === 0;
  }

  async exitCodeOf(args: string[]): Promise<number> {
    return (await this.execute(args, {})).exitCode;
  }

  async git(args: string[], run: GitRun = {}): Promise<string> {
    const result = await this.execute(args, run);

    enforceTrue(
      result.exitCode === 0,
      Error,
      `git ${args[0]} failed: ${redact(result.stderr, run.authArgs ?? [])}`,
    );

    return result.stdout;
  }

  private async execute(args: string[], run: GitRun): Promise<GitResult> {
    const argv = [...SAFE_PACK_ARGS, ...(run.authArgs ?? []), ...args];

    try {
      const { stdout } = await execFileAsync("git", argv, this.options());

      return { exitCode: 0, stdout: stdout.trim(), stderr: "" };
    } catch (error) {
      const failure = error as { code?: number; stderr?: string };

      return {
        exitCode: failure.code ?? -1,
        stdout: "",
        stderr: failure.stderr ?? "",
      };
    }
  }

  private options() {
    return {
      cwd: this.cacheDir,
      env: { ...this.env, GIT_TERMINAL_PROMPT: "0" },
      encoding: "utf8" as const,
      timeout: GIT_TIMEOUT_MS,
    };
  }
}

function redact(text: string, authArgs: string[]): string {
  const secrets = authArgs
    .filter((arg) => arg !== "-c")
    .flatMap((arg) => [arg, arg.split("Basic ")[1]])
    .filter(Boolean);

  return secrets.reduce(
    (cleaned, secret) => cleaned.split(secret).join("***"),
    text,
  );
}
