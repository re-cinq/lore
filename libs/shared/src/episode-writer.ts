/** Episode writer: auto-capture task outcomes (watcher + worker) with optional lesson extraction via LLM. */

import { createHash } from "node:crypto";
import { redactSecrets } from "./redact.js";
import { Llm } from "./llm/llm.js";
import type { MemoryLifecyclePort } from "./project/memory/memory-lifecycle-port.js";

export interface WriteEpisodeDeps {
  memory: MemoryLifecyclePort;
}

export type CurationDeps = WriteEpisodeDeps;

/** Write episode to memory.episodes; fire-and-forget, never throws, deduplicates via content_hash. */
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

/** Ask Haiku for a one/two-sentence lesson; returns null when there's nothing notable. */
async function extractLesson(
  content: string,
  taskId: string | undefined,
): Promise<string | null> {
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
    return null;
  }

  return lesson;
}

/** Write episode and extract optional "lesson learned" via Haiku, stored for future search. */
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

  try {
    const lesson = await extractLesson(content, taskId);

    if (!lesson) {
      return;
    }

    // Store as a memory entry
    const key = `auto-curation/${ref.replace(/[^a-zA-Z0-9\-/]/g, "_")}`;

    await deps.memory.upsertMemory({ agentId, key, value: lesson });
  } catch {
    // Curation is best-effort — never block task processing
  }
}
