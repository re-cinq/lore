/** Delete memories whose TTL has passed. */

import type { MemoryLifecyclePort } from "@re-cinq/lore-shared/project/memory/memory-lifecycle-port.js";

export async function memoryTtlJob(
  memory: MemoryLifecyclePort,
): Promise<string> {
  const count = await memory.expireMemories();

  return `Cleaned up ${count} expired memories`;
}
