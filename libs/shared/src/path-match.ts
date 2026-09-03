import { minimatch } from "minimatch";

const MATCH_OPTIONS = {
  dot: true,
  matchBase: false,
  nocase: false,
};

/** Returns true only when every changed path matches at least one glob in the allowlist; used by auto-merge engine (FR3.3). */
export function allPathsMatch(
  changedPaths: string[],
  allowlist: string[],
): boolean {
  if (changedPaths.length === 0) {
    return true;
  }

  if (allowlist.length === 0) {
    return false;
  }

  return changedPaths.every((path) =>
    allowlist.some((pattern) => minimatch(path, pattern, MATCH_OPTIONS)),
  );
}

/** Lists which patterns in the allowlist matched a path; useful for auto-merge audit log. */
export function matchingPatterns(path: string, allowlist: string[]): string[] {
  return allowlist.filter((p) => minimatch(path, p, MATCH_OPTIONS));
}
