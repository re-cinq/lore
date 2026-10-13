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
  const config = mergedConfig(row.config, next.config);

  return config === undefined ? patch : { ...patch, config };
}

function takesDefault(
  current: unknown,
  previous: unknown,
  next: unknown,
  previousDefault: ShippedFields | null,
): boolean {
  if (next === null || equivalent(current, next)) {
    return false;
  }

  return (
    current === null ||
    (previousDefault !== null && equivalent(current, previous))
  );
}

// The /agents form saves a textarea with CRLF line ends and no trailing newline; a prompt differing only so was not edited.
function equivalent(a: unknown, b: unknown): boolean {
  return typeof a === "string" && typeof b === "string"
    ? normalizedText(a) === normalizedText(b)
    : isDeepStrictEqual(a, b);
}

function normalizedText(text: string): string {
  return text.replace(/\r\n/g, "\n").trimEnd();
}

// Only pod_resources is writable from the /agents editor (agents-schema.ts), so the rest of config is code-owned and always follows the shipped default; pod_resources always survives.
function mergedConfig(
  current: CatalogConfig | null,
  next: CatalogConfig | null,
): CatalogConfig | null | undefined {
  const shipped = recipeOf(next);

  if (isDeepStrictEqual(recipeOf(current), shipped)) {
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

export interface SeedPlan {
  write: "insert" | "rewrite" | "remember" | "none";
  fields: ShippedFields;
  // Left differing from the shipped default after the merge: a kept edit, or a first-contact row the seed could not tell from one.
  diverged: boolean;
}

// What one boot does to one org row; `current` absent means no row exists yet.
export function planSeed(
  current: ShippedFields | undefined,
  remembered: ShippedFields | null,
  next: ShippedFields,
): SeedPlan {
  if (current === undefined) {
    return { write: "insert", fields: next, diverged: false };
  }
  const patch = mergeShippedDefault(current, remembered, next);
  const fields = { ...current, ...patch };

  return {
    write: rowWrite(patch, remembered, next),
    fields,
    diverged: !isDeepStrictEqual(recipeFields(fields), recipeFields(next)),
  };
}

function rowWrite(
  patch: Partial<ShippedFields>,
  remembered: ShippedFields | null,
  next: ShippedFields,
): SeedPlan["write"] {
  if (Object.keys(patch).length > 0) {
    return "rewrite";
  }

  return isDeepStrictEqual(remembered, next) ? "none" : "remember";
}

function recipeFields(fields: ShippedFields): ShippedFields {
  return {
    ...fields,
    prompt: fields.prompt === null ? null : normalizedText(fields.prompt),
    config: recipeOf(fields.config),
  };
}
