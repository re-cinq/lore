// AssemblyRun's cloned blueprint graph (specs/6-dark-factory FR6.38) — not the loader's AssemblyLine type (libs/shared can't import libs/assembly-lines); Station resolved at clone time, not on read, to avoid silent misrouting (FR6.26/FR6.31).

/** One node of a cloned graph. */
export interface RunGraphNode {
  id: string;
  type: string;
  /** Station this node dispatches to; null for a human station (its worker is a person). */
  station: string | null;
  /** True when the Station name is inherited (from node type or blueprint) rather than declared — wrong silently if the node is reused on a different task type. */
  station_inherited: boolean;
  /** Where a human station's worker acts (FR6.40); relative = platform page, absolute = external surface. {args.x} placeholders resolve at read time (e.g. pr_url doesn't exist until produced). */
  route?: string;
  prompt_ref?: string;
  model?: string;
  timeout_minutes?: number;
  /** Capability tags a claimant must carry (FR2); absent inherits the repo's station_default_tags at enqueue time. */
  required_tags?: string[];
  /** Station knobs passed through to the pod as params. */
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

/** The blueprint as one run recorded it, stored verbatim in pipeline.assembly_runs.graph; null for runs predating the column. */
export interface RunGraph {
  name: string;
  entry: string;
  exit: string;
  nodes: RunGraphNode[];
  edges: RunGraphEdge[];
}

/** The one {args.<name>} grammar; kept as source fragments, never a shared g-flag RegExp (lastIndex would leak between passes). */
const ARG_NAME = "[a-zA-Z0-9_]+";

/** Every braced placeholder's inner text, in order — what a validator iterates. */
export function routePlaceholders(route: string): string[] {
  return [...route.matchAll(/\{([^}]*)\}/g)].map(([, inner]) => inner);
}

/** Whether inner text is a placeholder resolveRoute can resolve; the loader validates with this predicate so "valid" and "resolvable" can't drift. */
export function isRouteArgPlaceholder(inner: string): boolean {
  return new RegExp(`^args\\.${ARG_NAME}$`).test(inner);
}

/** What a station-run row contributes to the wire shape, independent of which adapter read it. */
export interface StationRunFacts {
  nodeId: string;
  iteration: number;
  outcome: string | null;
  agentCrName: string | null;
  commitSha: string | null;
  startedAt: Date;
  finishedAt: Date | null;
}

/** What the run's own graph adds; every field is null-shaped, because a pre-clone run's blueprint may be gone. */
export interface NodeGraphFields {
  type: string | null;
  promptRef: string | null;
  route: string | null;
  station: string | null;
  stationInherited: boolean;
}

/** All a visit can say once its blueprint is gone, bar the route, which still resolves from the run's own args. */
const UNKNOWN_NODE = {
  type: null,
  promptRef: null,
  station: null,
  stationInherited: false,
} as const;

/** The one wire shape for a station run, so the Floor and lore-api cannot describe the same node two ways (FR6.38). */
export function describeStationRun(
  row: StationRunFacts,
  node: RunGraphNode | undefined,
  args: Record<string, unknown> = {},
) {
  return {
    nodeId: row.nodeId,
    iteration: row.iteration,
    outcome: row.outcome,
    agentCrName: row.agentCrName,
    commitSha: row.commitSha,
    startedAt: row.startedAt,
    finishedAt: row.finishedAt,
    ...nodeGraphFields(node, args),
  };
}

function nodeGraphFields(
  node: RunGraphNode | undefined,
  args: Record<string, unknown>,
): NodeGraphFields {
  // Resolved against THIS run's args (FR6.40); null when a placeholder is missing, since a half-built href is worse than none.
  if (!node) {
    return { ...UNKNOWN_NODE, route: resolveRoute(undefined, args) };
  }

  return {
    type: node.type,
    promptRef: node.prompt_ref ?? null,
    route: resolveRoute(node.route, args),
    station: node.station,
    stationInherited: node.station_inherited,
  };
}

/** Resolves a human station's route against run args; a not-yet-carried placeholder leaves it null rather than a half-built href (e.g. pr_url before the push node opens the PR). */
export function resolveRoute(
  route: string | undefined,
  args: Record<string, unknown>,
): string | null {
  if (!route) {
    return null;
  }
  const { resolved, missing } = substituteRouteArgs(route, args);

  return missing ? null : resolved;
}

/** Substitutes every {args.<name>} in place, reporting whether any placeholder had no usable value. */
function substituteRouteArgs(
  route: string,
  args: Record<string, unknown>,
): { resolved: string; missing: boolean } {
  let missing = false;
  const resolved = route.replace(
    new RegExp(`\\{args\\.(${ARG_NAME})\\}`, "g"),
    (_, name) => {
      if (!isUsableRouteArg(args[name])) {
        missing = true;

        return "";
      }

      return String(args[name]);
    },
  );

  return { resolved, missing };
}

/** An empty string is a missing value wearing quotes — substituting it builds the exact half-built href the null contract prevents. */
function isUsableRouteArg(value: unknown): boolean {
  return (
    (typeof value === "string" || typeof value === "number") && value !== ""
  );
}
