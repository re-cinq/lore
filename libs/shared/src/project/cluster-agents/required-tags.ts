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

/**
 * The tags a station run is enqueued with: the node's own list wins, an
 * absent list inherits the repo-level `settings.station_default_tags`, and an
 * absent default means `[]` — claimable by every registered cluster-agent.
 */
export function resolveRequiredTags(
  nodeTags: string[] | undefined,
  settings: Record<string, unknown> | null | undefined,
): string[] {
  if (nodeTags !== undefined) {
    return nodeTags;
  }
  const fallback = settings?.["station_default_tags"];

  return Array.isArray(fallback) && fallback.every((t) => typeof t === "string")
    ? fallback
    : [];
}
