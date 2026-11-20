import type {
  MirrorCommit,
  MirrorPulled,
  MirrorPullOutcome,
  MirrorPullRequest,
  MirrorPushOutcome,
  MirrorPushPort,
  MirrorPushRequest,
} from "./mirror-push-port.js";
import {
  decideMirrorPull,
  decideMirrorPush,
  type MirrorPullFacts,
  type MirrorPushFacts,
} from "./mirror-push-verdict.js";

export interface MirrorTargetState {
  head: string | null;
  tags: Record<string, string>;
}

export class InMemoryMirrorPush implements MirrorPushPort {
  private readonly targets = new Map<string, MirrorTargetState>();
  private readonly ancestors = new Map<string, Set<string>>();
  private readonly branches = new Map<string, string>();
  private readonly aheadCommits = new Map<string, MirrorCommit[]>();

  seedTarget(url: string, state: MirrorTargetState): void {
    this.targets.set(url, { head: state.head, tags: { ...state.tags } });
  }

  seedHistory(sha: string, ancestorShas: string[]): void {
    this.ancestors.set(sha, new Set(ancestorShas));
  }

  /** The commits a source's main holds that the target's main lacks, newest first. */
  seedAhead(sourceUrl: string, commits: MirrorCommit[]): void {
    this.aheadCommits.set(sourceUrl, commits);
  }

  seedBranch(url: string, branch: string, sha: string): void {
    this.branches.set(`${url}#${branch}`, sha);
  }

  branchOf(url: string, branch: string): string | null {
    return this.branches.get(`${url}#${branch}`) ?? null;
  }

  targetOf(url: string): MirrorTargetState {
    return this.targets.get(url) ?? { head: null, tags: {} };
  }

  async push(request: MirrorPushRequest): Promise<MirrorPushOutcome> {
    const { sha, tag } = request;
    const target = this.targetOf(request.targetUrl);
    const verdict = decideMirrorPush(this.factsOf(request, target));

    if (verdict.kind === "already-up-to-date") {
      return { kind: "already-up-to-date", sha, tag };
    }

    if (verdict.kind !== "push") {
      return verdict;
    }
    this.targets.set(request.targetUrl, {
      head: sha,
      tags: { ...target.tags, [tag]: sha },
    });

    return { kind: "pushed", sha, tag };
  }

  private factsOf(
    request: MirrorPushRequest,
    target: MirrorTargetState,
  ): MirrorPushFacts {
    const { head } = target;

    return {
      sha: request.sha,
      targetHead: head,
      targetHeadIsAncestor:
        head === request.sha ||
        this.ancestors.get(request.sha)?.has(head ?? "") === true,
      targetTagSha: target.tags[request.tag] ?? null,
    };
  }

  async pullBranch(request: MirrorPullRequest): Promise<MirrorPullOutcome> {
    const facts = this.pullFacts(request);
    const verdict = decideMirrorPull(facts);

    if (verdict.kind === "in-sync" || verdict.kind === "branch-diverged") {
      return verdict;
    }

    if (verdict.kind === "push") {
      this.seedBranch(request.targetUrl, request.branch, facts.publicHead);
    }

    return {
      kind: verdict.kind === "push" ? "pushed" : "already-pushed",
      ...this.pulledOf(request, facts.publicHead),
    };
  }

  private pullFacts(request: MirrorPullRequest): MirrorPullFacts {
    const publicHead = this.targetOf(request.sourceUrl).head ?? "";
    const branchHead = this.branchOf(request.targetUrl, request.branch);

    return {
      publicHead,
      publicHeadIsOnTarget: this.isAncestor(
        publicHead,
        this.targetOf(request.targetUrl).head,
      ),
      branchHead,
      branchHeadIsOnPublic: this.isAncestor(branchHead, publicHead),
    };
  }

  private pulledOf(
    request: MirrorPullRequest,
    publicHead: string,
  ): MirrorPulled {
    const commits = this.aheadCommits.get(request.sourceUrl) ?? [];

    return {
      publicHead,
      ahead: commits.length,
      commits: commits.slice(0, 20),
      mergedHeadOutsideTarget:
        request.mergedHead !== undefined &&
        !this.isAncestor(
          request.mergedHead,
          this.targetOf(request.targetUrl).head,
        ),
    };
  }

  private isAncestor(sha: string | null, descendant: string | null): boolean {
    return (
      sha !== null &&
      descendant !== null &&
      (sha === descendant || this.ancestors.get(descendant)?.has(sha) === true)
    );
  }
}
