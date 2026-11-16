import { DEFAULT_GITHUB_HOST, githubUrls } from "./github-host";

/** Resolve repo-markdown href for web UI; repo-relative → GitHub blob URL. */
export function resolveHref(
  rawHref: string,
  repo: string,
  branch: string,
  host: string = DEFAULT_GITHUB_HOST,
): { href: string; external: boolean } {
  if (!rawHref || /^(https?:|mailto:|tel:|#|\/\/)/i.test(rawHref)) {
    return { href: rawHref, external: /^https?:/i.test(rawHref) };
  }

  if (!repo.includes("/")) {
    return { href: rawHref, external: false };
  }
  const clean = rawHref.replace(/^\.?\//, "");

  return {
    href: `${githubUrls(host).web}/${repo}/blob/${branch}/${clean}`,
    external: true,
  };
}

/** Where a blob link lands: the lines it highlights, and the GitHub host it opens on. */
export interface LineRange {
  start?: number;
  end?: number;
  host?: string;
}

/** Build GitHub blob URL for repo-relative path, with optional line anchor. */
export function blobUrl(
  repo: string,
  branch: string,
  filePath: string,
  range: LineRange = {},
): string {
  if (!repo.includes("/")) {
    return "";
  }
  const clean = filePath.replace(/^\.?\//, "");
  const web = githubUrls(range.host ?? DEFAULT_GITHUB_HOST).web;

  return `${web}/${repo}/blob/${branch}/${clean}${lineAnchor(range)}`;
}

function lineAnchor({ start, end }: LineRange): string {
  if (start && end) {
    return `#L${start}-L${end}`;
  }

  return start ? `#L${start}` : "";
}
