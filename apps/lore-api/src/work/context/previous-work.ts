// Earlier work on a task's topic as one line each: the memories, sessions and episodes Lore's memory search found.

const MAX_CHARS = 600;

export function previousWorkLines(
  memories: { key: string; value: string }[],
): string[] {
  const lines = memories.map(
    (memory) => `memory ${memory.key}: ${memory.value.slice(0, MAX_CHARS)}`,
  );

  return [...new Set(lines)];
}
