import { MirrorGitRunner } from "./mirror-git-runner.js";
import { pullBranchWith } from "./mirror-pull-git.js";
import type {
  MirrorPullOutcome,
  MirrorPullRequest,
  MirrorPushOutcome,
  MirrorPushPort,
  MirrorPushRequest,
} from "./mirror-push-port.js";
import {
  decideMirrorPush,
  type MirrorPushFacts,
} from "./mirror-push-verdict.js";

const MAIN = "refs/heads/main";

export class GitMirrorPush implements MirrorPushPort {
  private readonly runner: MirrorGitRunner;

  constructor(cacheDir: string, env: NodeJS.ProcessEnv = process.env) {
    this.runner = new MirrorGitRunner(cacheDir, env);
  }

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

  pullBranch(request: MirrorPullRequest): Promise<MirrorPullOutcome> {
    return pullBranchWith(this.runner, request);
  }

  private async gatherFacts(
    request: MirrorPushRequest,
  ): Promise<MirrorPushFacts> {
    await this.fetchSource(request);
    const targetHead = await this.runner.remoteRef(
      request.targetUrl,
      request.targetAuthArgs,
      MAIN,
    );

    return {
      sha: request.sha,
      targetHead,
      targetHeadIsAncestor: targetHead
        ? await this.isAncestor(request, targetHead)
        : false,
      targetTagSha: await this.remoteTagSha(request),
    };
  }

  private async fetchSource(request: MirrorPushRequest): Promise<void> {
    await this.runner.ensureCache();
    await this.runner.fetchHead(
      request.sourceUrl,
      request.sourceAuthArgs,
      MAIN,
    );
    await this.runner.git(["cat-file", "-e", `${request.sha}^{commit}`]);
  }

  private async remoteTagSha(
    request: MirrorPushRequest,
  ): Promise<string | null> {
    const ref = `refs/tags/${request.tag}`;
    const listing = await this.runner.git(
      ["ls-remote", request.targetUrl, ref, `${ref}^{}`],
      { authArgs: request.targetAuthArgs },
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
    await this.runner.fetchHead(
      request.targetUrl,
      request.targetAuthArgs,
      MAIN,
    );

    return this.runner.isAncestor(targetHead, request.sha);
  }

  private async publish(request: MirrorPushRequest): Promise<void> {
    const tagRef = `refs/tags/${request.tag}`;

    await this.runner.git(["update-ref", tagRef, request.sha]);
    await this.runner.git(
      [
        "push",
        "--atomic",
        request.targetUrl,
        `${request.sha}:refs/heads/main`,
        tagRef,
      ],
      { authArgs: request.targetAuthArgs },
    );
  }
}
