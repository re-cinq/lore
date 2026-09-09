/** Where a spec-trace projection writes: the repo's `main` graph, or a per-run branch overlay that a query unions over it (issue #1769). */

/** The run segment that separates an overlay's xids from the `main` xids for the same paths. */
const RUN_SEGMENT = "run:";

/** The scope a projection writes into — the xid prefix, the `.repo` scalar, and the root node its chunks hang off. */
export interface TraceScope {
  /** The real repo, always `owner/name`, whatever the scope. */
  repo: string;
  /** The xid prefix AND the `.repo` scalar every node written in this scope carries; equal to `repo` on main. */
  key: string;
  /** The node this scope's chunks hang off — the Repo root on main, the run's Overlay node on a branch. */
  rootType: "Repo" | "Overlay";
  /** The assembly run this overlay belongs to; absent on main. */
  assemblyRunId?: string;
}

/** The repo's own `main` graph — the coordinate system every pre-merge query is expressed in. */
export function mainScope(repo: string): TraceScope {
  return { repo, key: repo, rootType: "Repo" };
}

/** One run's branch overlay. Its own xid namespace, so it upserts independently of main's node for the same path and bulk-deletes by prefix. */
export function overlayScope(repo: string, assemblyRunId: string): TraceScope {
  return {
    repo,
    key: `${repo}|${RUN_SEGMENT}${assemblyRunId}`,
    rootType: "Overlay",
    assemblyRunId,
  };
}

export function isOverlay(scope: TraceScope): boolean {
  return scope.rootType === "Overlay";
}

/** The xid for a node in this scope: the scope key followed by the parts that identify it within the repo. */
export function scopedXid(scope: TraceScope, ...parts: string[]): string {
  return [scope.key, ...parts].join("|");
}

// Trailing pipe on purpose: without it a prefix delete for `run:run-4` would also match `run:run-42`.
export function overlayKeyPrefix(repo: string, assemblyRunId: string): string {
  return `${overlayScope(repo, assemblyRunId).key}|`;
}

/** The root-edge predicate this scope attaches `name` to — `Repo.test_chunks` on main, `Overlay.test_chunks` on a branch. */
export function rootEdge(scope: TraceScope, name: string): string {
  return `${scope.rootType}.${name}`;
}

/** The repo and run an overlay key names, or null when the key is a bare repo. */
export function parseOverlayKey(
  key: string,
): { repo: string; assemblyRunId: string } | null {
  const marker = `|${RUN_SEGMENT}`;
  const at = key.lastIndexOf(marker);

  if (at === -1) {
    return null;
  }

  return {
    repo: key.slice(0, at),
    assemblyRunId: key.slice(at + marker.length),
  };
}
