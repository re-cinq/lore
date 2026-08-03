/** Pure markdown helpers for ReadmeBox, extracted so they are unit-testable
 *  without importing the JSX component. */

export function resolveUrl(url: string, base: string): string {
  if (/^(https?:|mailto:|#)/i.test(url)) {
    return url;
  }

  // Any other absolute scheme (javascript:, data:, vbscript:, …) is blanked —
  // `new URL` would pass it through unchanged, defeating the allowlist above.
  if (/^[a-z][a-z0-9+.-]*:/i.test(url)) {
    return "";
  }

  if (!base) {
    return url;
  }

  try {
    return new URL(url, base).toString();
  } catch {
    return url;
  }
}

export function splitBlocks(markdown: string): string[] {
  return markdown
    .split(/\n\s*\n/)
    .map((b) => b.trim())
    .filter(Boolean);
}
