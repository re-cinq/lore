import type { StationBackendKind } from "@re-cinq/lore-shared";

/** Which in-process handler a feature task takes, or null for the normal/Station
 *  ladder. Pure — the worker resolves the backend and dispatches.
 *
 *  feature-decompose and feature-finalize are deterministic coordinator-side ops
 *  (read the spec / accumulated draft, write via the GitHub API, no repo clone,
 *  no agent), so they always run in-process — this is what fixes the finalize bug
 *  where the Station path let the agent guess the slug + 404 on PR creation
 *  (ADR-029). feature-planning reasons over a repo clone, so it stays a Station
 *  unless the explicit `inprocess` escape hatch is set. */
export function featureTaskRoute(
  taskType: string,
  backend: StationBackendKind,
): "decompose" | "finalize" | "planning" | null {
  if (taskType === "feature-decompose") return "decompose";
  if (taskType === "feature-finalize") return "finalize";
  if (taskType === "feature-planning" && backend === "inprocess") return "planning";
  return null;
}
