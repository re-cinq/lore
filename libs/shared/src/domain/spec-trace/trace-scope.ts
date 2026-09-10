/** Where a spec-trace projection writes: the repo's `main` graph, or a branch overlay that a query unions over it (issue #1769). */

/** The branch segment that separates an overlay's xids from the `main` xids for the same paths. */
const BRANCH_SEGMENT = "branch:";

/** What `git rev-parse --abbrev-ref HEAD` prints on a detached checkout: a commit, not a branch, so it owns no overlay. */
const DETACHED_HEAD = "HEAD";

/** The scope a projection writes into — the xid prefix, the `.repo` scalar, and the root node its chunks hang off. */
export interface TraceScope {
  /** The real repo, always `owner/name`, whatever the scope. */
  repo: string;
  /** The xid prefix AND the `.repo` scalar every node written in this scope carries; equal to `repo` on main. */
  key: string;
  /** The node this scope's chunks hang off — the Repo root on main, the branch's Overlay node otherwise. */
  rootType: "Repo" | "Overlay";
  /** The branch this overlay describes; absent on main. */
  branch?: string;
}

/** The repo's own `main` graph — the coordinate system every pre-merge query is expressed in. */
export function mainScope(repo: string): TraceScope {
  return { repo, key: repo, rootType: "Repo" };
}

/** One branch's overlay. Its own xid namespace, so it upserts independently of main's node for the same path — and every run on the branch writes and reads the same one. */
export function overlayScope(repo: string, branch: string): TraceScope {
  return {
    repo,
    key: `${repo}|${BRANCH_SEGMENT}${branch}`,
    rootType: "Overlay",
    branch,
  };
}

/** The overlay a reported branch belongs in, or undefined when it describes the repo's default branch, which IS `main`'s graph. Every ingress that receives a branch applies this one rule. */
export function overlayBranchOf(
  reported: string | undefined,
  defaultBranch: string,
): string | undefined {
  if (!reported || reported === DETACHED_HEAD || reported === defaultBranch) {
    return undefined;
  }

  return reported;
}

export function isOverlay(scope: TraceScope): boolean {
  return scope.rootType === "Overlay";
}

/** The xid for a node in this scope: the scope key followed by the parts that identify it within the repo. */
export function scopedXid(scope: TraceScope, ...parts: string[]): string {
  return [scope.key, ...parts].join("|");
}

/** The root-edge predicate this scope attaches `name` to — `Repo.test_chunks` on main, `Overlay.test_chunks` on a branch. */
export function rootEdge(scope: TraceScope, name: string): string {
  return `${scope.rootType}.${name}`;
}
