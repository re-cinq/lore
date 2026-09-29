// Pod-based validate station (ADR-025). It no longer runs the repo's lint, typecheck or build in the pod: the pull request's CI runs them and is the judge (specs/implementation-loop FR15), and repeating them here OOM-killed the 1Gi pod on any TypeScript change to this monorepo (install + workspace build alone is ~950 MB) — spec-task T002, run 920c24d8, 2026-09-29. The node stays so runs already in flight keep the graph they started with.

import type { NodeResult } from "@re-cinq/lore-assembly-lines";
import type { StationInput } from "@re-cinq/lore-shared/station-input.js";
import type { StationEnv } from "../lib/station.js";

export async function runValidateStation(
  _input: StationInput,
  _env: StationEnv,
): Promise<NodeResult> {
  return { outcome: "success", extras: { "Lore-Validation": "ci" } };
}
