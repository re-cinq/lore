// Shared by lore-api (renders the catalog) and the cluster agent (create → 409 → replace) — a copy in each drifted and cost 5 days of platform-wide planning-result delivery.

type LooseRecord = Record<string, unknown>;

const rec = (v: unknown): LooseRecord =>
  typeof v === "object" && v !== null ? (v as LooseRecord) : {};

// Carries fields the editor does NOT own (labels/annotations, spec.output/resources members) from the live object into the replace body — a plain replace stripped `output.watch` and `skills_source`/`secrets`, killing planning-result delivery platform-wide 2026-08-13 to 08-18 (#1301).
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
