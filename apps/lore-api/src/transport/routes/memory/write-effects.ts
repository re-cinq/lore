// What a memory route's write starts in the background, since the caller is waiting on the write alone: a memory's fact extraction, and the Utopia memory mirror, which is a copy whose failed push is logged and counted, never the write's failure (specs/utopia-graph-mirror FR16).

import type { Pool } from "pg";
import { resolveAgentId } from "@re-cinq/lore-shared";
import { isMemoryDbAvailable } from "@re-cinq/lore-server-core/features/memory/memory.js";
import {
  mirrorEpisode,
  mirrorMemory,
} from "../../../work/utopia/memory/utopia-memory-push.js";
import { mirrorQuietly } from "../../../work/utopia/mirror-quietly.js";
import { extractFactsForMemory } from "../../../work/memory/fact-extraction.js";

interface MemoryWriteBody {
  key: string;
  value: string;
  agent_id?: string;
  repo?: string;
  extract_facts: boolean;
}

export function scheduleFactExtraction(
  pool: Pool | null,
  body: MemoryWriteBody,
) {
  if (!(body.extract_facts && isMemoryDbAvailable())) {
    return;
  }

  void extractFactsForMemory(pool!, {
    key: body.key,
    value: body.value,
    agentId: resolveAgentId(body.agent_id),
    repo: body.repo,
  });
}

/** A write or a delete as its body named the memory; only a DB write has rows to mirror. */
export function scheduleMemoryMirror(
  pool: Pool | null,
  body: { key: string; agent_id?: string; repo?: string },
) {
  if (!(pool && isMemoryDbAvailable())) {
    return;
  }
  const named = {
    key: body.key,
    agentId: resolveAgentId(body.agent_id),
    repo: body.repo,
  };

  void mirrorQuietly(body.repo ?? "memory", `memory:${body.key}`, () =>
    mirrorMemory(pool, named),
  );
}

/** What an episode insert returns; nothing comes back for a duplicate. */
export interface InsertedEpisode {
  id: string;
  created_at: string;
}

export function scheduleEpisodeMirror(
  pool: Pool,
  inserted: InsertedEpisode,
  stored: { content: string; ref: string | null },
) {
  const { content, ref } = stored;
  const episode = {
    id: inserted.id,
    content,
    createdAt: inserted.created_at,
    ref,
  };

  void mirrorQuietly(ref ?? "memory", `episode:${inserted.id}`, () =>
    mirrorEpisode(pool, episode),
  );
}
