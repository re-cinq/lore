import type { PackSyncResultBody } from "./models/pack-sync-state.js";

/** One line for a log: what a sync of the client's pack did. */
export function packSyncResultLine(result: PackSyncResultBody): string {
  if ("skipped" in result) {
    return "pack sync skipped: another replica holds the lease";
  }

  if (result.status === "applied") {
    return `pack ${result.commit} applied: ${result.changed.join(", ") || "none changed"}`;
  }

  if (result.status === "failed") {
    return `pack sync FAILED, the floor keeps what it holds: ${result.error}`;
  }

  return "no pack configured on this deployment";
}
