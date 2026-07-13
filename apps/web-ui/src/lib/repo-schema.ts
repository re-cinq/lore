/** Postgres identifier shape for a team chunk schema (also the injection guard). */
export const SCHEMA_RE = /^[a-z][a-z0-9_]{0,62}$/;

/** Fallback schema every onboarded cluster provisions; holds cross-team chunks. */
export const ORG_SHARED_SCHEMA = "org_shared";

/**
 * Resolve a repo's chunk schema: the team's own schema when it is actually
 * provisioned, otherwise org_shared.
 *
 * A team value can be a valid identifier yet have no schema behind it — e.g. a
 * name typed into the free-text team field on the settings page. Returning it
 * anyway would interpolate `<team>.chunks` into SQL that throws 42P01 and 500s
 * the page, so an unprovisioned team must fall back to org_shared.
 */
export function pickSchema(
  team: string | null | undefined,
  existingSchemas: readonly string[],
): string {
  const candidate = team ?? "";
  if (SCHEMA_RE.test(candidate) && existingSchemas.includes(candidate))
    return candidate;
  return ORG_SHARED_SCHEMA;
}
