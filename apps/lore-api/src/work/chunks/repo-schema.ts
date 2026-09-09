/** Postgres identifier shape for a team chunk schema (also the injection guard). */
export const SCHEMA_RE = /^[a-z][a-z0-9_]{0,62}$/;

/** Fallback schema every onboarded cluster provisions; holds cross-team chunks. */
export const ORG_SHARED_SCHEMA = "org_shared";

// Resolve repo schema: team's own if provisioned, otherwise org_shared (unprovisioned falls back).
export function pickSchema(
  team: string | null | undefined,
  existingSchemas: readonly string[],
): string {
  const candidate = team ?? "";

  if (SCHEMA_RE.test(candidate) && existingSchemas.includes(candidate)) {
    return candidate;
  }

  return ORG_SHARED_SCHEMA;
}
