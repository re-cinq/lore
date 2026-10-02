// Binds the bus housekeeping to the ports this process holds (composition root).
import { pruneBus } from "@re-cinq/lore-shared/housekeeping/bus-prune.js";
import { deliveries, pipeline } from "../../outbound/queues.js";

export function runBusPrune(): Promise<string> {
  const { agentRunEvents, agentRunTurns } = pipeline();

  return pruneBus({ deliveries: deliveries(), agentRunEvents, agentRunTurns });
}
