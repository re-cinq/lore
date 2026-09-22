/** The capability-tag matching rules (FR2 specs/running-stations-in-any-k8s-cluster): flat tag set matched by inclusion. */

/** `required <@ offered` — every required tag present; `[]` matches anyone. */
export function tagsSatisfy(required: string[], offered: string[]): boolean {
  return required.every((tag) => offered.includes(tag));
}

/** The structural capability tag for a node type: `ingest` → `node:ingest`. */
export function nodeTypeTag(nodeType: string): string {
  return `node:${nodeType}`;
}

/** Offered by a cluster whose pods can download their input files from it, and required of the one claiming a pod that does: without it the pod starts with no plan.md. */
export const AGENT_FILES_TAG = "agent-files";

/** The tags a station run is enqueued with: node-type tag ALWAYS required (#1576), then repo defaults. */
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
