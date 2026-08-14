// The graph an AssemblyRun carries a copy of (specs/6-dark-factory FR6.38).
//
// Deliberately NOT the loader's `AssemblyLine` type. Two reasons, both load-bearing:
//
//   * `libs/shared` cannot import `libs/assembly-lines` — that package depends on
//     THIS one, and importing back would invert the dependency.
//   * A persisted wire format should not be the authoring schema. The YAML gains
//     fields for authors' convenience; this is what a RUN needs in order to be
//     replayable years later, and the two are free to drift apart on purpose.
//
// `libs/assembly-lines` produces it: `snapshotGraph` IMPORTS these types (that
// package depends on this one, so the import runs downhill). Field names are
// the BLUEPRINT's, because the graph is a copy of one: renaming them would buy
// nothing and cost a translation on every read, and it lets the walk consume a
// stored graph and a freshly loaded one through the same structural type.
//
// The Station is RESOLVED here rather than derived on read. An agent node that
// declares no `station_ref` inherits the one named after its run's blueprint, and
// re-deriving that at every call site is how three separate nodes silently ran the
// planning recipe and reported success for it (FR6.26, FR6.31). Recording the
// answer once, at clone time, is what stops that being a runtime hazard.

/** One node of a cloned graph. */
export interface RunGraphNode {
  id: string;
  type: string;
  /** The Station this node dispatches to; null when nothing dispatches (a human
   *  station's worker is a person, so naming a Station would imply otherwise). */
  station: string | null;
  /** True when the Station name came from the node's TYPE or its run's blueprint
   *  rather than from the node itself — the case that silently becomes wrong when
   *  a node is reused on a blueprint whose task type differs. */
  station_inherited: boolean;
  /** Where a HUMAN station's worker acts (FR6.40). Relative — a page this
   *  platform serves; absolute — a surface it does not own, such as a GitHub PR.
   *  `{args.x}` placeholders resolve against the run's args AT READ TIME, because
   *  a value like `pr_url` does not exist until a node has produced it. */
  route?: string;
  prompt_ref?: string;
  model?: string;
  timeout_minutes?: number;
  /** Station knobs passed through to the pod as params. */
  validator?: string;
  condition_ref?: string;
  job_ref?: string;
  /** Which prior run this node continues, and which thread it belongs to. */
  continues?: { node: string; key: string };
  description?: string;
}

/** One edge of a cloned graph. */
export interface RunGraphEdge {
  from: string;
  to: string;
  on: string;
  iteration_max?: number;
}

/**
 * The blueprint as one run recorded it. Stored verbatim in
 * `pipeline.assembly_runs.graph`; null for runs that predate the column.
 */
export interface RunGraph {
  name: string;
  entry: string;
  exit: string;
  nodes: RunGraphNode[];
  edges: RunGraphEdge[];
}

/**
 * Resolve a human station's `route` against a run's args.
 *
 * `{args.feature_id}` reads `args.feature_id`. A placeholder the run does not
 * carry yet leaves the route UNRESOLVED (null) rather than rendering a link with
 * a hole in it: `args.pr_url` is absent until the push node opens the PR, and a
 * half-built href sends the reader to a page that does not exist.
 */
export function resolveRoute(
  route: string | undefined,
  args: Record<string, unknown>,
): string | null {
  if (!route) {
    return null;
  }
  let missing = false;
  const resolved = route.replace(/\{args\.([a-zA-Z0-9_]+)\}/g, (_, name) => {
    const value = args[name];

    if (typeof value !== "string" && typeof value !== "number") {
      missing = true;

      return "";
    }

    return String(value);
  });

  return missing ? null : resolved;
}
