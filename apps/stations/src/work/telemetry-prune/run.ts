// Binds the telemetry reap to the ports this process holds (composition root).
import { pruneTelemetry } from "@re-cinq/lore-shared/housekeeping/telemetry-retention.js";
import { pipeline } from "../../outbound/queues.js";

export function runTelemetryPrune(): Promise<string> {
  const { agentRunEvents, podLogs } = pipeline();

  return pruneTelemetry({ runEvents: agentRunEvents, podLogs });
}
