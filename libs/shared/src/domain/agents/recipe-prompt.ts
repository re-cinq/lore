/** What every agent run is told about its own context: fills the recipe's `{context}` slot with an instruction (not the fetched context itself — that needed a central-only credential, so every run now opens cold and identically regardless of cluster). */
export const CONTEXT_BOOTSTRAP =
  "First step: nothing is pre-loaded for this run — call `lore_assemble_context` " +
  "with a query describing the task above (then `lore_search_memory` for past " +
  "learnings) before you change anything. The `lore_*` tools stay live for the whole run.";
