// Where a need's ref leads (run-viz FR4.4l): a git ref to its branch on GitHub, a URL to itself, a blob hash to the page that renders it. Anything else is a plain value, and a link to nowhere would only look like one.

export interface NeedLink {
  href: string;
  external: boolean;
}

const BLOB_HASH = /^sha256-[0-9a-f]{64}$/;
const WEB_URL = /^https?:\/\/\S+$/;
const GITHUB_REF = /^github\.com\/([^/@\s]+)\/([^/@\s]+)(?:@(.+))?$/;

export function needLink(ref: string, runId: string): NeedLink | null {
  if (BLOB_HASH.test(ref)) {
    return { href: `/assembly-runs/${runId}/blobs/${ref}`, external: false };
  }

  return WEB_URL.test(ref) ? { href: ref, external: true } : githubLink(ref);
}

/** The commit a git item was promised, on GitHub; null without a sha or off GitHub. */
export function commitLink(
  ref: string,
  sha: string | null | undefined,
): string | null {
  const match = GITHUB_REF.exec(ref);

  return match && sha
    ? `https://github.com/${match[1]}/${match[2]}/commit/${encodeURIComponent(sha)}`
    : null;
}

/** `github.com/owner/name@branch`, as the floor writes a git item's ref. */
function githubLink(ref: string): NeedLink | null {
  const match = GITHUB_REF.exec(ref);

  if (match === null) {
    return null;
  }
  const [, owner, name, branch] = match;
  const repo = `https://github.com/${owner}/${name}`;

  return {
    href: branch ? `${repo}/tree/${encodedBranch(branch)}` : repo,
    external: true,
  };
}

/** A branch name keeps its slashes and encodes everything else, so `feat/a b#1` cannot end the path early. */
function encodedBranch(branch: string): string {
  return branch.split("/").map(encodeURIComponent).join("/");
}
