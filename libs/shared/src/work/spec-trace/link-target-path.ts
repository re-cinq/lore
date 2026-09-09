/** spec-traceability-graph — inline-link target normalizer: resolves repo-relative or spec-relative link targets to one repo-relative path so chunk xids/coverage joins line up, dropping non-file targets (fragments, empty strings, paths escaping the repo root). */

import { posix } from "node:path";

/** True for a path that resolved outside/at the repo root and so isn't a usable file target. */
function escapesRepoRoot(resolved: string): boolean {
  return resolved === "" || resolved === "." || resolved.startsWith("..");
}

/** Resolves a relative `path` against the spec's directory; leaves an already repo-relative path untouched. */
function resolveAgainstSpec(specFilePath: string, path: string): string {
  const isRelative = path.startsWith("./") || path.startsWith("../");

  return isRelative
    ? posix.normalize(posix.join(posix.dirname(specFilePath), path))
    : path;
}

/** Normalizes an inline-link `target` to a repo-relative POSIX path (leading `./`/`../` resolves against the spec's directory), or null when not a usable file target; any `#fragment` is stripped first. */
export function repoRelativeLinkTarget(
  specFilePath: string,
  target: string,
): string | null {
  const path = target.split("#")[0];

  if (path === "") {
    return null;
  }
  const resolved = resolveAgainstSpec(specFilePath, path);

  return escapesRepoRoot(resolved) ? null : resolved;
}
