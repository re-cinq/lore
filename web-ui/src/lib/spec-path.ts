/**
 * Validates and normalizes a spec file path entered in the "Add Spec" form.
 * A path is valid when, after trimming and stripping leading slashes, it is
 * non-empty and ends with `.md`.
 */
export function validateSpecPath(raw: string): { valid: boolean; path: string } {
  const path = (raw || '').trim().replace(/^\/+/, '');
  return { valid: path.length > 0 && path.endsWith('.md'), path };
}
