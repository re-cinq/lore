// The write-side door to the memory mirror (specs/utopia-graph-mirror FR16): after lore-api writes or deletes a memory, or inserts an episode, the document goes to its base's api source at once. The stations' sweeps cannot push; the walk carries what they change.

import {
  episodeDocument,
  memoryDocument,
  type MirroredEpisode,
} from "@re-cinq/lore-shared/utopia/memory-documents.js";
import {
  utopiaConfigured,
  type UtopiaEnv,
} from "@re-cinq/lore-shared/utopia/utopia-client.js";
import type { Pool } from "pg";
import {
  memoriesNamed,
  type StoredMemory,
} from "../../outbound/memory-rows.js";
import { memoryBaseOf, pushToBase } from "./utopia-memory-base.js";

/** The memory as Lore's write or delete named it: a repo's memory by repo and key, an agent's own by agent and key. */
export interface NamedMemory {
  key: string;
  agentId?: string;
  repo?: string;
}

/** Reads the key's rows back as the write or the delete left them, so a live row is pushed, a deleted one tombstoned, and the agent the document is named after is the row's, not the caller's. */
export async function mirrorMemory(
  pool: Pool,
  named: NamedMemory,
  env: UtopiaEnv = process.env,
): Promise<void> {
  if (utopiaConfigured(env)) {
    await pushMemories(pool, await memoriesNamed(pool, named), env);
  }
}

export async function mirrorEpisode(
  pool: Pool,
  episode: MirroredEpisode & { ref: string | null },
  env: UtopiaEnv = process.env,
): Promise<void> {
  const base = utopiaConfigured(env)
    ? await memoryBaseOf(pool, episode.ref, env)
    : null;

  if (base) {
    await pushToBase(
      pool,
      base,
      { kind: "episodes", document: episodeDocument(episode) },
      env,
    );
  }
}

async function pushMemories(
  pool: Pool,
  memories: StoredMemory[],
  env: UtopiaEnv,
): Promise<void> {
  await Promise.all(
    memories.map(async (memory) => {
      const base = await memoryBaseOf(pool, memory.repo, env);

      if (base) {
        await pushToBase(
          pool,
          base,
          { kind: "memories", document: memoryDocument(memory) },
          env,
        );
      }
    }),
  );
}
