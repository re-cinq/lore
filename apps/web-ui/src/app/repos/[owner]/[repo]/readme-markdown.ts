/** Pure markdown helpers for ReadmeBox; extracted for unit-testability without JSX. */
export function resolveUrl(url: string, base: string): string {
  if (/^(https?:|mailto:|#)/i.test(url)) {
    return url;
  }

  // Other absolute schemes (javascript:, data:, vbscript:, …) blanked to defeat `new URL` pass-through.
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
