// Binds the blocked-reason purge to this process's pool (composition root).
import { prunePrBlockedReasons } from "@re-cinq/lore-shared/housekeeping/pr-blocked-reasons-retention.js";
import { getPool } from "@re-cinq/lore-shared/db/pg-pool.js";

export function runPrBlockedReasonsPrune(): Promise<string> {
  return prunePrBlockedReasons(getPool());
}
