import { minimatch } from "minimatch";

const MATCH_OPTIONS = {
  dot: true, // match dotfiles (e.g. .claude/**)
  matchBase: false, // require explicit ** for nested matching
  nocase: false, // path matches are case-sensitive on Linux
};

/**
 * Returns true only when **every** changed path matches at least one
 * glob in the allowlist. Empty `changedPaths` returns true (vacuous);
 * empty `allowlist` returns false.
 *
 * Used by the auto-merge engine to gate path-allowlisted PRs (FR3.3).
 * Mixed PRs — one allowlisted path plus one non-allowlisted — are
 * intentionally denied: the rule is "all paths in scope," not "any."
 */
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

/**
 * Lists which patterns in the allowlist matched a path. Useful for
 * diagnostics in the auto-merge audit log.
 */
export function matchingPatterns(path: string, allowlist: string[]): string[] {
  return allowlist.filter((p) => minimatch(path, p, MATCH_OPTIONS));
}
