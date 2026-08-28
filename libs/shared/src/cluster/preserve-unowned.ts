// Merging a rendered CRD onto the live one without amputating what the renderer
// does not know about.
//
// Shared because BOTH writers need it: lore-api renders the UI-authored catalog,
// and the cluster agent performs the create → 409 → replace that actually lands
// it. A copy in each is a copy that drifts, and the incident this guards against
// cost five days of platform-wide planning-result delivery.

type LooseRecord = Record<string, unknown>;

const rec = (v: unknown): LooseRecord =>
  typeof v === "object" && v !== null ? (v as LooseRecord) : {};

/**
 * Carry the fields the editor does NOT own from the live object into the body
 * about to replace it (#1301). The /agents mapping builds a CRD from the DB
 * row, which knows nothing of `output.watch` (or `format`/`schema`/`select`,
 * or helm's labels/annotations) — a plain replace therefore amputated the
 * artifact declaration from the feature-planning recipe on 2026-08-13 and
 * killed planning-result delivery platform-wide until 08-18. Rules: the editor
 * owns what it renders (desired wins key-by-key); everything the live object
 * carries that the render does not gets preserved — `metadata.labels`,
 * `metadata.annotations`, the members of `spec.output` beside `sinks`, and the
 * members of `spec.resources` the render omits. The resources rule is the same
 * incident in a different field (2026-08): the /agents render knows only
 * `mcp_servers`, so a plain replace stripped `skills_source` (and `secrets`)
 * from a recipe, and every Claude-agent node cloned from it died at startup
 * with "Settings file not found" — skills config belongs to each cluster's
 * catalog seed, which is exactly why the editor cannot re-render it.
 */
export function preserveUnownedFields<T extends object>(
  current: unknown,
  desired: T,
): T {
  const cur = rec(current);
  const des = rec(desired);
  const curMeta = rec(cur.metadata);
  const desMeta = rec(des.metadata);
  const curSpec = rec(cur.spec);
  const desSpec = rec(des.spec);
  const merged: LooseRecord = {
    ...des,
    metadata: {
      ...desMeta,
      labels: { ...rec(curMeta.labels), ...rec(desMeta.labels) },
      annotations: {
        ...rec(curMeta.annotations),
        ...rec(desMeta.annotations),
      },
    },
  };

  const mergedSpec: LooseRecord = { ...desSpec };
  let specTouched = false;

  for (const field of ["output", "resources"]) {
    if (field in curSpec || field in desSpec) {
      mergedSpec[field] = { ...rec(curSpec[field]), ...rec(desSpec[field]) };
      specTouched = true;
    }
  }

  if (specTouched) {
    merged.spec = mergedSpec;
  }

  return merged as T;
}
