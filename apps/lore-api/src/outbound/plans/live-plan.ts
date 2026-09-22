// A plan as it stands in its live collaboration document — the same document the agent writer edits, so what a pod downloads is what people see right now.

import {
  docName,
  type BlockJson,
  type PlanMeta,
} from "@re-cinq/planning-document";
import { readBlocks } from "@re-cinq/planning-yjs";
import type { PlanningSync } from "@re-cinq/planning-sync/hapi";

export interface LivePlan {
  meta: PlanMeta;
  blocks: BlockJson[];
}

export function livePlanOf(
  sync: Pick<PlanningSync, "service" | "collab">,
): (planId: string) => Promise<LivePlan> {
  return async (planId) => {
    const { json } = await sync.service.readPlan(planId);
    const connection = await sync.collab.openDirectConnection(
      docName({ repo: json.repo, planId: json.id }),
    );
    const read: BlockJson[][] = [];

    try {
      await connection.transact((document) => read.push(readBlocks(document)));
    } finally {
      await connection.disconnect();
    }

    return { meta: json, blocks: read[0] ?? [] };
  };
}
