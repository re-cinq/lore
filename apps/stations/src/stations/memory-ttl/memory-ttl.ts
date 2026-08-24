/**
 * Delete memories whose TTL has passed.
 *
 * One DELETE behind a port. It had its own CronJob pod built from the
 * coordinator's image before it left the Floor; it is a station now because that
 * is what a single data operation on a schedule is.
 */

import type { MemoryLifecyclePort } from "@re-cinq/lore-shared/project/memory/memory-lifecycle-port.js";

export async function memoryTtlJob(
  memory: MemoryLifecyclePort,
): Promise<string> {
  const count = await memory.expireMemories();

  return `Cleaned up ${count} expired memories`;
}
