/** Node matches when trimmed lowercase query is substring of label or path. */
export function nodeMatchesQuery(
  node: { label?: string; path?: string },
  query: string,
): boolean {
  const q = query.trim().toLowerCase();

  if (!q) {
    return true;
  }

  return (
    (node.label ?? "").toLowerCase().includes(q) ||
    (node.path ?? "").toLowerCase().includes(q)
  );
}
