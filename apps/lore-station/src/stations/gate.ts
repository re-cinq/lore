// The gate station: a deterministic condition node. Gate conditions
// (auto_merge_eligible, review_passed, …) are evaluated Floor-side today — the
// assembly-line kernel's gate handler is a success stub — so the station
// preserves that default and echoes the condition for the trace. When a real
// pod-side condition is needed it plugs in here without touching the contract.

import type { NodeResult } from "@re-cinq/lore-assembly-lines";
import type { StationInput } from "@re-cinq/lore-shared/station-input.js";

export async function runGateStation(input: StationInput): Promise<NodeResult> {
  return {
    outcome: "success",
    extras: { "Lore-Gate": input.params.condition_ref ?? "none" },
  };
}
