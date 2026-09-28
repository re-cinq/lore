// The run-closed fallback (specs/daily-digest FR9): a refine pod that died uploaded nothing, so the draft the Floor stored when the pod asked for it is posted instead. Idempotent through the digest_posts claim, so a run whose upload already posted is a no-op here.

import type { AssemblyRunRecord } from "@re-cinq/lore-shared/project/assembly-runs/assembly-runs-port.js";
import { DAILY_DIGEST_LINE } from "@re-cinq/lore-shared/digest/contract.js";
import { deliverDigestRun, type DeliverDeps } from "./deliver-digest.js";

export async function digestRunClosed(
  run: AssemblyRunRecord,
  deps: DeliverDeps,
): Promise<void> {
  if (run.blueprintName !== DAILY_DIGEST_LINE) {
    return;
  }
  const delivery = await deliverDigestRun(run, null, deps);

  console.log(`[digest] run ${run.id} closed: ${delivery.outcome}`);
}
