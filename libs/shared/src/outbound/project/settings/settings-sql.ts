/** The named settings block as stored, or an empty one when it is absent or was cleared to null: `null || {…}` would make a JSONB array. */
export function storedBlock(block: string): string {
  return `(CASE WHEN jsonb_typeof(settings->'${block}') = 'object' THEN settings->'${block}' ELSE '{}'::jsonb END)`;
}
