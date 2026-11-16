// A plan's Refine asks as its live document holds them: they live beside the blocks and never reach the stored plan JSON.

import type { Hocuspocus } from "@hocuspocus/server";
import { docName, type RefineProposal } from "@re-cinq/planning-document";
import { proposalsIn } from "@re-cinq/planning-yjs";

export async function liveRefineAsks(
  collab: Hocuspocus,
  plan: { id: string; repo: string },
): Promise<RefineProposal[]> {
  const connection = await collab.openDirectConnection(
    docName({ repo: plan.repo, planId: plan.id }),
  );

  try {
    return proposalsIn(connection.document!);
  } finally {
    await connection.disconnect();
  }
}
