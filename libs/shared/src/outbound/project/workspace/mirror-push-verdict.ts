export interface MirrorPushFacts {
  sha: string;
  targetHead: string | null;
  targetHeadIsAncestor: boolean;
  targetTagSha: string | null;
}

export type MirrorPushVerdict =
  | { kind: "push" }
  | { kind: "already-up-to-date" }
  | { kind: "target-diverged"; targetHead: string }
  | { kind: "tag-at-other-sha"; tagSha: string };

export function decideMirrorPush(facts: MirrorPushFacts): MirrorPushVerdict {
  const { sha, targetHead, targetTagSha } = facts;

  if (targetTagSha && targetTagSha !== sha) {
    return { kind: "tag-at-other-sha", tagSha: targetTagSha };
  }

  if (targetHead && !facts.targetHeadIsAncestor) {
    return { kind: "target-diverged", targetHead };
  }

  return isPublished(facts) ? { kind: "already-up-to-date" } : { kind: "push" };
}

function isPublished(facts: MirrorPushFacts): boolean {
  return facts.targetHead === facts.sha && facts.targetTagSha === facts.sha;
}

export interface MirrorPullFacts {
  publicHead: string;
  publicHeadIsOnTarget: boolean;
  branchHead: string | null;
  branchHeadIsOnPublic: boolean;
}

export type MirrorPullVerdict =
  | { kind: "in-sync" }
  | { kind: "push" }
  | { kind: "already-pushed" }
  | { kind: "branch-diverged"; branchHead: string };

export function decideMirrorPull(facts: MirrorPullFacts): MirrorPullVerdict {
  const { publicHead, branchHead } = facts;

  if (facts.publicHeadIsOnTarget) {
    return { kind: "in-sync" };
  }

  if (branchHead === publicHead) {
    return { kind: "already-pushed" };
  }

  return branchHead && !facts.branchHeadIsOnPublic
    ? { kind: "branch-diverged", branchHead }
    : { kind: "push" };
}
