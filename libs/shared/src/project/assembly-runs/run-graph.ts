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

/** Resolves a human station's route against run args; a not-yet-carried placeholder leaves it null rather than a half-built href (e.g. pr_url before the push node opens the PR). */
export function resolveRoute(
  route: string | undefined,
  args: Record<string, unknown>,
): string | null {
  if (!route) {
    return null;
  }
  let missing = false;
  const resolved = route.replace(
    new RegExp(`\\{args\\.(${ARG_NAME})\\}`, "g"),
    (_, name) => {
      const value = args[name];

      // An empty string is a missing value wearing quotes — substituting it builds the exact half-built href the null contract prevents.
      if (
        (typeof value !== "string" && typeof value !== "number") ||
        value === ""
      ) {
        missing = true;

        return "";
      }

      return String(value);
    },
  );

  // eslint-disable-next-line @typescript-eslint/no-unnecessary-condition -- TS doesn't narrow across the replace() callback's mutation of `missing`
  return missing ? null : resolved;
}
