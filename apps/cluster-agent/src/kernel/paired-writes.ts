// The catalog read-modify-write pair, kept whole on this side of the network.
//
// It is here rather than inline in `deps.ts` because it is a DECISION — a
// write order — and `deps.ts` is an IO shell excluded from coverage. It
// shipped with a defect while it lived there: written in the order its own
// sibling's comment argued against. Decision logic in an IO shell is decision
// logic nobody tests.
//
// The status read-modify-write that used to live beside this one is gone with
// the route it backed (`PATCH /api/cluster/agents/{name}/status`) — the
// watcher went cluster-blind and nothing calls it any more.

import { preserveUnownedFields } from "@re-cinq/lore-shared";
import type { AgentDefinition, Station } from "@re-cinq/agent-contracts";

/** The catalog half of a recipe, applied Station FIRST.
 *
 *  The mirror of `deletePair`: the AgentDefinition is what a dispatch looks up,
 *  so writing it LAST means a recipe is never visible pointing at a station
 *  that does not exist yet. Applying them the other way round opens exactly
 *  that window, and `deletePair` already said so about its own order.
 */
export async function applyCatalogPair(
  catalog: CatalogWriter,
  {
    agentDefinition,
    station,
  }: { agentDefinition: AgentDefinition; station: Station },
): Promise<void> {
  // Both reads together — only the WRITE order is load-bearing, and each write
  // waits on its own read anyway.
  const [liveStation, liveDefinition] = await Promise.all([
    catalog.getStation(station.metadata!.name!),
    catalog.getAgentDefinition(agentDefinition.metadata!.name!),
  ]);

  await catalog.applyStation(mergeOntoLive(liveStation, station));
  await catalog.applyAgentDefinition(
    mergeOntoLive(liveDefinition, agentDefinition),
  );
}

/** The four catalog calls an apply makes. `metadata.name` is guaranteed by the
 *  route's schema, which is why the assertions above are safe. */
export interface CatalogWriter {
  getStation(name: string): Promise<Station | null>;
  getAgentDefinition(name: string): Promise<AgentDefinition | null>;
  applyStation(station: Station): Promise<void>;
  applyAgentDefinition(def: AgentDefinition): Promise<void>;
}

function mergeOntoLive<T extends AgentDefinition | Station>(
  live: unknown,
  desired: T,
): T {
  return live ? preserveUnownedFields(live, desired) : desired;
}
