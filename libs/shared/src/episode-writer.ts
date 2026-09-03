/**
 * Episode writer — shared utility for automatic episode capture
 * and optional LLM-driven curation (lesson extraction).
 *
 * Used by the agent watcher (PR, no-changes, failure) and worker
 * (feature-request, onboard) to passively capture task outcomes
 * as searchable episodes with fact extraction.
 */

import { createHash } from "node:crypto";
import { redactSecrets } from "./redact.js";
import { Llm } from "./llm/llm.js";
import type { MemoryLifecyclePort } from "./project/memory/memory-lifecycle-port.js";

export interface WriteEpisodeDeps {
  memory: MemoryLifecyclePort;
}

export type CurationDeps = WriteEpisodeDeps;

/**
 * Write an episode to memory.episodes. Fire-and-forget — never throws.
 * Deduplicates via content_hash.
 */
/** One episode to record: what happened, which surface saw it, and what it is about. */
export interface EpisodeInput {
  content: string;
  source: string;
  ref: string;
  /** Defaults to "loretask-watcher", the preserved external identity the memory.* agent_id has always been written under; renaming it means migrating existing rows. */
  agentId?: string;
}

export interface CuratedEpisodeInput extends EpisodeInput {
  taskId?: string;
}

// Deps FIRST: this used to default to the Floor's `memoryLifecycle()` singleton, which is exactly what stopped it being callable from anywhere else.
export async function writeEpisode(
  deps: WriteEpisodeDeps,
  { content, source, ref, agentId = "loretask-watcher" }: EpisodeInput,
): Promise<string | null> {
  try {
    // Privacy filter: strip secrets/keys before storing in org-wide memory
    const safeContent = redactSecrets(content);
    const contentHash = createHash("sha256").update(safeContent).digest("hex");

    return await deps.memory.insertEpisode({
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
  deps: CurationDeps,
  {
    taskId,
    content,
    source,
    ref,
    agentId = "loretask-watcher",
  }: CuratedEpisodeInput,
): Promise<void> {
  // Write the episode first (always)
  const episodeId = await writeEpisode(deps, { content, source, ref, agentId });

  // Skip curation if no API key or episode was a duplicate
  if (!episodeId || !process.env.ANTHROPIC_API_KEY) {
    return;
  }

  // Extract a lesson learned via Haiku
  try {
    const result = await Llm.instance.complete({
      prompt: `Extract one concise lesson learned from this task outcome. Focus on what went well, what went wrong, or what pattern should be remembered for future tasks. Return just the lesson in 1-2 sentences. If there's nothing notable, respond with "SKIP".\n\n${content.substring(0, 4000)}`,
      systemPrompt:
        "You are a post-task curator extracting reusable lessons from agent task outcomes.",
      maxTokens: 256,
      taskId: taskId || undefined,
      jobName: "auto-curation",
    });

    const lesson = result.text.trim();

    if (!lesson || lesson.startsWith("SKIP") || lesson.length < 10) {
      return;
    }

    // Store as a memory entry
    const key = `auto-curation/${ref.replace(/[^a-zA-Z0-9\-/]/g, "_")}`;

    await deps.memory.upsertMemory({ agentId, key, value: lesson });
  } catch {
    // Curation is best-effort — never block task processing
  }
}
