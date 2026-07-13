/** Pure markdown helpers for ReadmeBox, extracted so they are unit-testable
 *  without importing the JSX component. */

export function resolveUrl(url: string, base: string): string {
  if (/^(https?:|mailto:|data:|#)/i.test(url) || !base) {
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
