// Where a need's ref leads (run-viz FR4.4l): a git ref to its branch on GitHub, a URL to itself, a blob hash to the page that renders it. Anything else is a plain value, and a link to nowhere would only look like one.
import {
  DEFAULT_GITHUB_HOST,
  githubHostPattern,
  githubUrls,
} from "./github-host";

export interface NeedLink {
  href: string;
  external: boolean;
}

const BLOB_HASH = /^sha256-[0-9a-f]{64}$/;
const WEB_URL = /^https?:\/\/\S+$/;

export function needLink(
  ref: string,
  runId: string,
  host: string = DEFAULT_GITHUB_HOST,
): NeedLink | null {
  if (BLOB_HASH.test(ref)) {
    return { href: `/assembly-runs/${runId}/blobs/${ref}`, external: false };
  }

  return WEB_URL.test(ref)
    ? { href: ref, external: true }
    : githubLink(ref, host);
}

/** The commit a git item was promised, on GitHub; null without a sha or off GitHub. */
export function commitLink(
  ref: string,
  sha: string | null | undefined,
  host: string = DEFAULT_GITHUB_HOST,
): string | null {
  const match = githubRefPattern(host).exec(ref);

  return match && sha
    ? `${githubUrls(host).web}/${match[1]}/${match[2]}/commit/${encodeURIComponent(sha)}`
    : null;
}

/** `<github host>/owner/name@branch`, as the floor writes a git item's ref. */
function githubLink(ref: string, host: string): NeedLink | null {
  const match = githubRefPattern(host).exec(ref);

  if (match === null) {
    return null;
  }
  const [, owner, name, branch] = match;
  const repo = `${githubUrls(host).web}/${owner}/${name}`;

  return {
    href: branch ? `${repo}/tree/${encodedBranch(branch)}` : repo,
    external: true,
  };
}

/** A branch name keeps its slashes and encodes everything else, so `feat/a b#1` cannot end the path early. */
function encodedBranch(branch: string): string {
  return branch.split("/").map(encodeURIComponent).join("/");
}

function githubRefPattern(host: string): RegExp {
  return new RegExp(
    `^${githubHostPattern(host)}/([^/@\\s]+)/([^/@\\s]+)(?:@(.+))?$`,
  );
}
