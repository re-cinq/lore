// Reads whose results a memory/episode write can change; over-invalidating is safe, it only forces the next read to re-fetch.
export const MEMORY_DERIVED_READS = [
  "lore_search_memory",
  "lore_read_memory",
  "lore_list_memories",
  "lore_assemble_context",
];

// A memory addressed by key. `agent_id` is optional everywhere: absent means "this agent", resolved once at the edge.
export interface KeyedMemoryArgs {
  key: string;
  agent_id?: string;
}
