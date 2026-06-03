/**
 * Episode writer — shared utility for automatic episode capture
 * and optional LLM-driven curation (lesson extraction).
 *
 * Used by loretask-watcher (PR, no-changes, failure) and worker
 * (feature-request, onboard) to passively capture task outcomes
 * as searchable episodes with fact extraction.
 */

import { createHash } from "node:crypto";
import { redactSecrets } from "@re-cinq/lore-shared";
import { callLLM as defaultCallLLM } from "../anthropic.js";
import {
  pgEpisodes,
  pgMemories,
  type EpisodeRepository,
  type MemoryRepository,
} from "../repositories/index.js";

export interface WriteEpisodeDeps {
  episodes: EpisodeRepository;
}

export interface CurationDeps extends WriteEpisodeDeps {
  memories: MemoryRepository;
  callLLM: typeof defaultCallLLM;
}

/**
 * Write an episode to memory.episodes. Fire-and-forget — never throws.
 * Deduplicates via content_hash.
 */
export async function writeEpisode(
  content: string,
  source: string,
  ref: string,
  agentId: string = "loretask-watcher",
  deps: WriteEpisodeDeps = { episodes: pgEpisodes },
): Promise<string | null> {
  try {
    // Privacy filter: strip secrets/keys before storing in org-wide memory
    const safeContent = redactSecrets(content);
    const contentHash = createHash("sha256").update(safeContent).digest("hex");
    return await deps.episodes.insert({
      agentId,
      content: safeContent,
      contentHash,
      source,
      ref,
    });
  } catch {
    return null;
  }
}

/**
 * Write an episode and optionally extract a "lesson learned" via Haiku.
 * The lesson is stored as a memory entry for future search.
 */
export async function writeEpisodeWithCuration(
  content: string,
  source: string,
  ref: string,
  agentId: string = "loretask-watcher",
  taskId?: string,
  deps: CurationDeps = {
    episodes: pgEpisodes,
    memories: pgMemories,
    callLLM: defaultCallLLM,
  },
): Promise<void> {
  // Write the episode first (always)
  const episodeId = await writeEpisode(content, source, ref, agentId, deps);

  // Skip curation if no API key or episode was a duplicate
  if (!episodeId || !process.env.ANTHROPIC_API_KEY) return;

  // Extract a lesson learned via Haiku
  try {
    const result = await deps.callLLM({
      prompt: `Extract one concise lesson learned from this task outcome. Focus on what went well, what went wrong, or what pattern should be remembered for future tasks. Return just the lesson in 1-2 sentences. If there's nothing notable, respond with "SKIP".\n\n${content.substring(0, 4000)}`,
      systemPrompt: "You are a post-task curator extracting reusable lessons from agent task outcomes.",
      maxTokens: 256,
      taskId: taskId || undefined,
      jobName: "auto-curation",
    });

    const lesson = result.text.trim();
    if (!lesson || lesson.startsWith("SKIP") || lesson.length < 10) return;

    // Store as a memory entry
    const key = `auto-curation/${ref.replace(/[^a-zA-Z0-9\-\/]/g, "_")}`;
    await deps.memories.upsert({ agentId, key, value: lesson });
  } catch {
    // Curation is best-effort — never block task processing
  }
}
