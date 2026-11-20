import type {
  MirrorPushOutcome,
  MirrorPushPort,
  MirrorPushRequest,
} from "./mirror-push-port.js";
import {
  decideMirrorPush,
  type MirrorPushFacts,
} from "./mirror-push-verdict.js";

export interface MirrorTargetState {
  head: string | null;
  tags: Record<string, string>;
}

export class InMemoryMirrorPush implements MirrorPushPort {
  private readonly targets = new Map<string, MirrorTargetState>();
  private readonly ancestors = new Map<string, Set<string>>();

  seedTarget(url: string, state: MirrorTargetState): void {
    this.targets.set(url, { head: state.head, tags: { ...state.tags } });
  }

  seedHistory(sha: string, ancestorShas: string[]): void {
    this.ancestors.set(sha, new Set(ancestorShas));
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
}
