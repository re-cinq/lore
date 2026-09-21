// What a boot changes on an existing org-default row: untouched fields follow the shipped default, edited ones stay, NULL ones fill.

import { isDeepStrictEqual } from "node:util";
import type {
  CatalogConfig,
  ShippedFields,
} from "../models/agent-definition.js";

export type { ShippedFields };

const SCALAR_FIELDS = [
  "model",
  "timeout_minutes",
  "prompt",
  "execution_mode",
  "review_required",
] as const;

// `previous` is the default last seeded onto this row, null on first contact: then only NULL fields fill, since an edit cannot be told from an older default.
export function mergeShippedDefault(
  row: ShippedFields,
  previous: ShippedFields | null,
  next: ShippedFields,
): Partial<ShippedFields> {
  const patch: Partial<ShippedFields> = {};

  for (const field of SCALAR_FIELDS) {
    if (takesDefault(row[field], previous?.[field], next[field], previous)) {
      Object.assign(patch, { [field]: next[field] });
    }
  }
  const config = mergedConfig(
    row.config,
    previous?.config,
    next.config,
    previous,
  );

  return config === undefined ? patch : { ...patch, config };
}

function takesDefault(
  current: unknown,
  previous: unknown,
  next: unknown,
  previousDefault: ShippedFields | null,
): boolean {
  if (next === null || isDeepStrictEqual(current, next)) {
    return false;
  }

  return (
    current === null ||
    (previousDefault !== null && isDeepStrictEqual(current, previous))
  );
}

// pod_resources belongs to the UI (the /agents editor), so it is compared on neither side and always survives an adopted default.
function mergedConfig(
  current: CatalogConfig | null,
  previous: CatalogConfig | null | undefined,
  next: CatalogConfig | null,
  previousDefault: ShippedFields | null,
): CatalogConfig | null | undefined {
  const shipped = recipeOf(next);
  const live = recipeOf(current);

  if (
    !takesDefault(live, recipeOf(previous ?? null), shipped, previousDefault)
  ) {
    return undefined;
  }
  const podResources = current?.pod_resources;
  const merged = {
    ...shipped,
    ...(podResources ? { pod_resources: podResources } : {}),
  };

  return Object.keys(merged).length > 0 ? merged : null;
}

// A config's recipe half, null when nothing but pod_resources is set — that row never had a recipe to call edited.
function recipeOf(config: CatalogConfig | null): CatalogConfig | null {
  if (config === null) {
    return null;
  }
  const { pod_resources: _podResources, ...recipe } = config;

  return Object.keys(recipe).length > 0 ? recipe : null;
}
