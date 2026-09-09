/** One reader of the station manifest's node triggers, so callers ask for the triggers rather than reaching through the module to them. */

import { nodeStationFor } from "@re-cinq/lore-stations";

/** The triggers declared by the station claiming this node type; empty when none does. */
export function nodeTriggersFor(nodeType: string) {
  const station = nodeStationFor(nodeType);

  return station?.manifest.triggers ?? [];
}
