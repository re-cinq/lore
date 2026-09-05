/** Best-effort per-task token + AgentDefinition/Station cleanup (#697). A job service: the watcher reclaims it when a task settles, the walk when a whole line is done, and the review line when its own run ends. */

import { HttpTokenCleanup } from "@re-cinq/lore-shared";
import { clusterAgent } from "../../kernel/queues.js";

export function cleanupPerTaskToken(taskId: string): Promise<void> {
  return new HttpTokenCleanup(clusterAgent()).cleanup(taskId).catch((err) =>
    // Swallowed so a task still settles on reclaim failure, but logged (used to hide a 403).
    console.warn(
      `[agent-watcher] token cleanup for ${taskId} failed:`,
      (err as Error).message,
    ),
  );
}
