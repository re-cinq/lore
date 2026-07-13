import type { MemoryLifecyclePort } from "@re-cinq/lore-shared/project/memory/memory-lifecycle-port.js";
import { memoryLifecycle } from "../../../kernel/queues.js";

export async function ttlCleanupJob(
  memory: MemoryLifecyclePort = memoryLifecycle(),
): Promise<string> {
  const count = await memory.expireMemories();

  if (count > 0) {
    console.log(`[job] ttl-cleanup: removed ${count} expired memories`);
  }

  return `Cleaned up ${count} expired memories`;
}
