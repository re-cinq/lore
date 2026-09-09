// The catalog read-modify-write pair, kept whole here rather than inline in `deps.ts` (an IO shell excluded from coverage) since the write ORDER is a decision that needs testing.

import { preserveUnownedFields } from "@re-cinq/lore-shared";
import type { AgentDefinition, Station } from "@re-cinq/agent-contracts";

/** The catalog half of a recipe, applied Station FIRST (mirror of `deletePair`) — writing the AgentDefinition last means a recipe is never visible pointing at a missing station. */
export async function applyCatalogPair(
  catalog: CatalogWriter,
  {
    agentDefinition,
    station,
  }: { agentDefinition: AgentDefinition; station: Station },
): Promise<void> {
  // Both reads together — only the WRITE order is load-bearing; neither write depends on the other's read result.
  const [liveStation, liveDefinition] = await Promise.all([
    catalog.getStation(station.metadata!.name!),
    catalog.getAgentDefinition(agentDefinition.metadata!.name!),
  ]);

  await catalog.applyStation(mergeOntoLive(liveStation, station));
  await catalog.applyAgentDefinition(
    mergeOntoLive(liveDefinition, agentDefinition),
  );
}

/** The four catalog calls an apply makes; `metadata.name` is guaranteed by the route's schema, which is why the assertions above are safe. */
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
