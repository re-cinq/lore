import type { LeaseBackend } from "@re-cinq/lore-shared/project/leases/lease-backends.js";
import {
  applyPack,
  type PackApplyResult,
  type PackDeps,
} from "./apply-pack.js";

export const PACK_SYNC_LEASE = "pack-sync";

const LEASE_TTL_SECONDS = 300;

export type PackSyncResult = PackApplyResult | { skipped: "lease held" };

/** One replica at a time applies the pack: every replica gets the same push, boots at the same time and ticks on its own schedule. */
export async function syncPack(
  deps: PackDeps,
  leases: LeaseBackend,
  holder: string,
): Promise<PackSyncResult> {
  const lease = await leases.acquire(
    PACK_SYNC_LEASE,
    null,
    holder,
    LEASE_TTL_SECONDS,
  );

  if (!lease.acquired) {
    return { skipped: "lease held" };
  }

  try {
    return await applyPack(deps);
  } finally {
    await leases.release(PACK_SYNC_LEASE, holder);
  }
}
