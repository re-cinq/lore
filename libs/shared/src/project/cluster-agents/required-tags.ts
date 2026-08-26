/**
 * The capability-tag matching rules (FR2 of
 * specs/running-stations-in-any-k8s-cluster): a flat tag set matched by
 * inclusion — no scheduler, no scoring. The SQL claim uses `<@`; these are
 * the same semantics for every non-SQL caller (the InMemory double, the
 * enqueue seam, tests), so the two can never disagree.
 */

/** `required <@ offered` — every required tag present; `[]` matches anyone. */
export function tagsSatisfy(required: string[], offered: string[]): boolean {
  return required.every((tag) => offered.includes(tag));
}

/** The structural capability tag for a node type: `ingest` → `node:ingest`. */
export function nodeTypeTag(nodeType: string): string {
  return `node:${nodeType}`;
}

/**
 * The tags a station run is enqueued with. The node type's own tag is ALWAYS
 * required — a run is claimable only by an agent that declares capability for
 * that node type. Before this invariant, a run's tag list could be empty,
 * which means "claimable by every registered cluster": the first real
 * satellite legally drained the production ingest queue into pods that could
 * never start, because ingest pods mount the central-only LORE_INGEST_TOKEN
 * (#1576). Central-only-ness is now structural: satellites simply never
 * receive `node:ingest`.
 *
 * On top of the type tag: the node's own list wins, an absent list inherits
 * the repo-level `settings.station_default_tags`, and an absent default adds
 * nothing.
 */
export function resolveRequiredTags(
  nodeType: string,
  nodeTags: string[] | undefined,
  settings: Record<string, unknown> | null | undefined,
): string[] {
  const fallback = settings?.["station_default_tags"];
  const extra =
    nodeTags ??
    (Array.isArray(fallback) && fallback.every((t) => typeof t === "string")
      ? fallback
      : []);

  return [...new Set([nodeTypeTag(nodeType), ...extra])];
}
