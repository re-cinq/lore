// Which node types are worked by a PERSON (specs/6-dark-factory FR6.40) — a type here also needs a manifest in `apps/stations`; `route` belongs to the NODE (loader-required, resolved from run args at read time, e.g. pr_review on {args.pr_url}).

// feature_review = planning wizard's per-section form (accept/refine/abandon); pr_review = GitHub PR view (merged/changes requested/closed unmerged), reported by webhook not a served form.
import {
  routePlaceholders,
  isRouteArgPlaceholder,
} from "@re-cinq/lore-shared/project/assembly-runs/run-graph.js";

export const HUMAN_STATION_TYPES = ["feature_review", "pr_review"] as const;

export type HumanStationType = (typeof HUMAN_STATION_TYPES)[number];

const HUMAN: ReadonlySet<string> = new Set<string>(HUMAN_STATION_TYPES);

// True when this node's worker is a person; takes a plain string so a blueprint node, a run's clone, and a jsonb-read row all answer through the same call.
export function isHumanStation(nodeType: string | null | undefined): boolean {
  return typeof nodeType === "string" && HUMAN.has(nodeType);
}

// Placeholders in `route` that are NOT `{args.<name>}` — routes resolve only against the run's args (keeping the engine domain-free), built on the same grammar `resolveRoute` reads so the loader can never bless a placeholder resolving to a dead link.
export function invalidRoutePlaceholders(route: string): string[] {
  return routePlaceholders(route)
    .filter((inner) => !isRouteArgPlaceholder(inner))
    .map((inner) => `{${inner}}`);
}
