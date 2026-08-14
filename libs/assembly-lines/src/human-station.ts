// Which node types are worked by a PERSON (specs/6-dark-factory FR6.40).
//
// One predicate, imported everywhere, rather than `type === "wait"` repeated at
// each site. That repetition is what this replaces: the old generic type said
// only THAT a person acts, so every consumer that needed to know WHERE they act
// grew its own answer — the web UI kept a hardcoded map of node ids to interface
// phases, which silently omitted any node nobody remembered to add to it.
//
// A human station declares its own type (the form contract) and a `route` (the
// page that form lives on). Adding one here is the whole registration: the
// loader will demand its route, the walk will dispatch nothing for it, and the
// reaper will never time it out.

/**
 * `feature_review` — the planning wizard's per-section feedback form: accept,
 * refine, or abandon a round.
 *
 * `pr_review` — the GitHub PR view: merged, changes requested, or closed
 * unmerged. Reported by webhook rather than by a form this platform serves.
 */
import {
  routePlaceholders,
  isRouteArgPlaceholder,
} from "@re-cinq/lore-shared/project/assembly-runs/run-graph.js";

export const HUMAN_STATION_TYPES = ["feature_review", "pr_review"] as const;

export type HumanStationType = (typeof HUMAN_STATION_TYPES)[number];

const HUMAN: ReadonlySet<string> = new Set<string>(HUMAN_STATION_TYPES);

/**
 * True when this node's worker is a person.
 *
 * Takes a plain string so a blueprint node, the clone a run carries, and a row
 * read back out of jsonb all answer through the same call.
 */
export function isHumanStation(nodeType: string | null | undefined): boolean {
  return typeof nodeType === "string" && HUMAN.has(nodeType);
}

/**
 * The placeholders in `route` that are NOT `{args.<name>}`.
 *
 * Routes resolve against the run's args and nothing else, which is what keeps
 * the engine domain-free — it still never learns what a feature is, it only
 * reads the value the run carries. Built on the grammar `resolveRoute` reads
 * with (shared owns it) so the loader can never bless a placeholder that
 * resolves to a dead link.
 */
export function invalidRoutePlaceholders(route: string): string[] {
  return routePlaceholders(route)
    .filter((inner) => !isRouteArgPlaceholder(inner))
    .map((inner) => `{${inner}}`);
}
