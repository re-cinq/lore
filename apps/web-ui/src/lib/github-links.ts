/** Resolve repo-markdown href for web UI; repo-relative → GitHub blob URL. */
export function resolveHref(
  rawHref: string,
  repo: string,
  branch: string,
): { href: string; external: boolean } {
  if (!rawHref || /^(https?:|mailto:|tel:|#|\/\/)/i.test(rawHref)) {
    return { href: rawHref, external: /^https?:/i.test(rawHref) };
  }

  if (!repo.includes("/")) {
    return { href: rawHref, external: false };
  }
  const clean = rawHref.replace(/^\.?\//, "");

  return {
    href: `https://github.com/${repo}/blob/${branch}/${clean}`,
    external: true,
  };
}

/** Build GitHub blob URL for repo-relative path, with optional line anchor. */
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
