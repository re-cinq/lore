// Semantic memory search is single-sourced in @re-cinq/lore-shared
// (project/knowledge/memory-search); re-exported here for back-compat with
// this module's existing importers (routes/memory, index, context-assembly).
export { searchMemories, type MemorySearchResult } from "@re-cinq/lore-shared/project/knowledge/memory-search.js";
