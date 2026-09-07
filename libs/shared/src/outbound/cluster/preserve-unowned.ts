// Shared by lore-api (renders the catalog) and the cluster agent (create → 409 → replace) — a copy in each drifted and cost 5 days of platform-wide planning-result delivery.

type LooseRecord = Record<string, unknown>;

const rec = (v: unknown): LooseRecord =>
  typeof v === "object" && v !== null ? (v as LooseRecord) : {};

/** Labels and annotations MERGE rather than replace — a controller writing its own annotation onto the object must not lose it every time the editor saves. */
function mergedMetadata(curMeta: LooseRecord, desMeta: LooseRecord) {
  return {
    ...desMeta,
    labels: { ...rec(curMeta.labels), ...rec(desMeta.labels) },
    annotations: { ...rec(curMeta.annotations), ...rec(desMeta.annotations) },
  };
}

/** The spec with `output` and `resources` merged member-wise, or null when neither side declares either — the two blocks whose members are contributed by producers the editor never sees. Returning null rather than an empty spec keeps a spec-less object spec-less. */
function mergedSpec(
  curSpec: LooseRecord,
  desSpec: LooseRecord,
): LooseRecord | null {
  const merged: LooseRecord = { ...desSpec };
  let touched = false;

  for (const field of ["output", "resources"]) {
    if (field in curSpec || field in desSpec) {
      merged[field] = { ...rec(curSpec[field]), ...rec(desSpec[field]) };
      touched = true;
    }
  }

  return touched ? merged : null;
}

// Carries fields the editor does NOT own (labels/annotations, spec.output/resources members) from the live object into the replace body — a plain replace stripped `output.watch` and `skills_source`/`secrets`, killing planning-result delivery platform-wide 2026-08-13 to 08-18 (#1301).
export function preserveUnownedFields<T extends object>(
  current: unknown,
  desired: T,
): T {
  const cur = rec(current);
  const des = rec(desired);
  const merged: LooseRecord = {
    ...des,
    metadata: mergedMetadata(rec(cur.metadata), rec(des.metadata)),
  };
  const spec = mergedSpec(rec(cur.spec), rec(des.spec));

  if (spec) {
    merged.spec = spec;
  }

  return merged as T;
}
