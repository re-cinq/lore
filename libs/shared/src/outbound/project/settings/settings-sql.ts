/** The named settings block as stored, or an empty one when it is absent or was cleared to null: `null || {…}` would make a JSONB array. */
export function storedBlock(block: string): string {
  return `(CASE WHEN jsonb_typeof(settings->'${block}') = 'object' THEN settings->'${block}' ELSE '{}'::jsonb END)`;
}

/** True for a repo another repo names as its `public_mirror`; `fullNameColumn` is the outer row's name, qualified so the subquery cannot capture it. */
export function isMirrorSql(fullNameColumn: string): string {
  return `EXISTS (SELECT 1 FROM lore.repos publisher WHERE lower(publisher.settings->>'public_mirror') = lower(${fullNameColumn}))`;
}

export const NOT_A_MIRROR_SQL = `NOT ${isMirrorSql("lore.repos.full_name")}`;
