/**
 * Pure node-search predicate for the spec-graph live filter. A node matches when
 * the (trimmed, lower-cased) query is a substring of its label or path. An empty
 * query matches every node, so clearing the search box restores the full view.
 */
export function nodeMatchesQuery(node: { label?: string; path?: string }, query: string): boolean {
  const q = query.trim().toLowerCase();
  if (!q) return true;
  return `${node.label ?? ""} ${node.path ?? ""}`.toLowerCase().includes(q);
}
