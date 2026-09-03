/** Resolve a repo-markdown href for display in the web UI. Repo-relative
 * paths (test links, ADR/doc refs) can't resolve inside the app, so point
 * them at the file on GitHub (and open in a new tab); absolute URLs and
 * in-page anchors are left untouched. */
export function resolveHref(
  rawHref: string,
  repo: string,
  branch: string,
): { href: string; external: boolean } {
  if (!rawHref || /^(https?:|mailto:|tel:|#|\/\/)/i.test(rawHref)) {
    return { href: rawHref, external: /^https?:/i.test(rawHref) };
  }

  // Only rewrite when we know the owner/name repo; otherwise leave as-is.
  if (!repo.includes("/")) {
    return { href: rawHref, external: false };
  }
  const clean = rawHref.replace(/^\.?\//, "");

  return {
    href: `https://github.com/${repo}/blob/${branch}/${clean}`,
    external: true,
  };
}

/** Build a GitHub blob URL for a repo-relative file path, with an optional
 * `#L{start}-L{end}` (or `#L{start}`) line anchor. Returns '' when the repo
 * is not an `owner/name` pair (e.g. an unknown chunk repo). */
export function blobUrl(
  repo: string,
  branch: string,
  filePath: string,
  { start, end }: { start?: number; end?: number } = {},
): string {
  if (!repo.includes("/")) {
    return "";
  }
  const clean = filePath.replace(/^\.?\//, "");
  const base = `https://github.com/${repo}/blob/${branch}/${clean}`;

  if (start && end) {
    return `${base}#L${start}-L${end}`;
  }

  if (start) {
    return `${base}#L${start}`;
  }

  return base;
}
