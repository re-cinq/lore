/** Pure helpers for the feature detail page load. */

import type { DecompTaskRow } from "@/lib/decomposition-view";
import type { AgentDefinition } from "@/lib/agents-mirror";

interface ApiResult<T> {
  status: string;
  data?: T;
}

const DEFAULT_PLANNING_TIMEOUT_MINUTES = 15;

/** The story/task rows a merged spec decomposed into, or none when the read failed. */
export function decompositionRows(
  decomp: ApiResult<{ tasks: DecompTaskRow[] }>,
): DecompTaskRow[] {
  return decomp.status === "ok" ? (decomp.data?.tasks ?? []) : [];
}

/** The feature-planning agent's configured timeout, or the wizard's default. */
export function planningTimeoutOf(agents: AgentDefinition[]): number {
  return (
    agents.find((a) => a.name === "feature-planning")?.timeout_minutes ??
    DEFAULT_PLANNING_TIMEOUT_MINUTES
  );
}
