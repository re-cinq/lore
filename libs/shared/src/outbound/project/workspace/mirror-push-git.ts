import { execFile } from "node:child_process";
import { existsSync } from "node:fs";
import { join } from "node:path";
import { promisify } from "node:util";
import { enforceTrue } from "../../../lib/enforce.js";
import type {
  MirrorPushOutcome,
  MirrorPushPort,
  MirrorPushRequest,
} from "./mirror-push-port.js";
import {
  decideMirrorPush,
  type MirrorPushFacts,
} from "./mirror-push-verdict.js";

const execFileAsync = promisify(execFile);
const GIT_TIMEOUT_MS = 5 * 60 * 1000;
const NOT_AN_ANCESTOR_EXIT_CODE = 1;
const SAFE_PACK_ARGS = ["-c", "pack.threads=1", "-c", "pack.windowMemory=64m"];

interface GitResult {
  exitCode: number;
  stdout: string;
  stderr: string;
}

interface GitRun {
  authArgs?: string[];
  cwd?: string;
}
export class GitMirrorPush implements MirrorPushPort {
  constructor(
    private readonly cacheDir: string,
    private readonly env: NodeJS.ProcessEnv = process.env,
  ) {}

  async push(request: MirrorPushRequest): Promise<MirrorPushOutcome> {
    const { sha, tag } = request;
    const verdict = decideMirrorPush(await this.gatherFacts(request));

    if (verdict.kind === "already-up-to-date") {
      return { kind: "already-up-to-date", sha, tag };
    }

    if (verdict.kind !== "push") {
      return verdict;
    }
    await this.publish(request);

    return { kind: "pushed", sha, tag };
  }

  private async gatherFacts(
    request: MirrorPushRequest,
  ): Promise<MirrorPushFacts> {
    await this.ensureCache();
    await this.fetchMain(request.sourceUrl, request.sourceAuthArgs);
    await this.git(["cat-file", "-e", `${request.sha}^{commit}`], {
      cwd: this.cacheDir,
    });
    const targetHead = await this.remoteRef(request, "refs/heads/main");

    return {
      sha: request.sha,
      targetHead,
      targetHeadIsAncestor: targetHead
        ? await this.isAncestor(request, targetHead)
        : false,
      targetTagSha: await this.remoteTagSha(request),
    };
  }

  private async ensureCache(): Promise<void> {
    if (existsSync(join(this.cacheDir, "HEAD"))) {
      return;
    }
    await this.git(["init", "--bare", "--quiet", this.cacheDir]);
  }

  private async fetchMain(url: string, authArgs: string[]): Promise<void> {
    await this.git(["fetch", "--no-tags", url, "refs/heads/main"], {
      authArgs,
      cwd: this.cacheDir,
    });
  }

  private async remoteRef(
    request: MirrorPushRequest,
    ref: string,
  ): Promise<string | null> {
    const listing = await this.git(["ls-remote", request.targetUrl, ref], {
      authArgs: request.targetAuthArgs,
      cwd: this.cacheDir,
    });

    return listing.split("\t")[0] || null;
  }

  private async remoteTagSha(
    request: MirrorPushRequest,
  ): Promise<string | null> {
    const ref = `refs/tags/${request.tag}`;
    const listing = await this.git(
      ["ls-remote", request.targetUrl, ref, `${ref}^{}`],
      { authArgs: request.targetAuthArgs, cwd: this.cacheDir },
    );
    const shaByRef = new Map(
      listing
        .split("\n")
        .filter(Boolean)
        .map((line) => line.split("\t").reverse() as [string, string]),
    );

    return shaByRef.get(`${ref}^{}`) ?? shaByRef.get(ref) ?? null;
  }

  private async isAncestor(
    request: MirrorPushRequest,
    targetHead: string,
  ): Promise<boolean> {
    await this.fetchMain(request.targetUrl, request.targetAuthArgs);
    const exitCode = await this.exitCodeOf(
      ["merge-base", "--is-ancestor", targetHead, request.sha],
      { cwd: this.cacheDir },
    );

    enforceTrue(
      exitCode === 0 || exitCode === NOT_AN_ANCESTOR_EXIT_CODE,
      Error,
      `git merge-base failed with exit code ${exitCode}`,
    );

    return exitCode === 0;
  }

  private async publish(request: MirrorPushRequest): Promise<void> {
    const tagRef = `refs/tags/${request.tag}`;

    await this.git(["update-ref", tagRef, request.sha], { cwd: this.cacheDir });
    await this.git(
      [
        "push",
        "--atomic",
        request.targetUrl,
        `${request.sha}:refs/heads/main`,
        tagRef,
      ],
      { authArgs: request.targetAuthArgs, cwd: this.cacheDir },
    );
  }

  private async exitCodeOf(args: string[], run: GitRun): Promise<number> {
    return (await this.execute(args, run)).exitCode;
  }

  private async git(args: string[], run: GitRun = {}): Promise<string> {
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
      const { stdout } = await execFileAsync("git", argv, this.options(run));

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

  private options(run: GitRun) {
    return {
      cwd: run.cwd,
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
