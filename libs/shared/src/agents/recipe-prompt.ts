/**
 * What every agent run is told about its own context.
 *
 * Runs used to start warm: a dispatcher fetched assembled context over HTTP and
 * wrote it into the CR's `context` parameter, which the recipe's `{context}`
 * placeholder rendered. That fetch needed a credential which never leaves the
 * central cluster, so the same recipe opened differently depending on which
 * cluster claimed it. Now nothing is fetched at dispatch and every run opens the
 * same way — with this instruction in the slot the context used to occupy.
 *
 * It is deliberately an INSTRUCTION rather than an empty string. The installed
 * `lore-context` skill already teaches the same call order; what it cannot know
 * is whether this particular run arrived pre-loaded. Saying so removes the
 * assumption the old context block created.
 */
export const CONTEXT_BOOTSTRAP =
  "First step: nothing is pre-loaded for this run — call `lore_assemble_context` " +
  "with a query describing the task above (then `lore_search_memory` for past " +
  "learnings) before you change anything. The `lore_*` tools stay live for the whole run.";
