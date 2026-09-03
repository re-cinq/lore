/** spec-traceability-graph — inline-link target normalizer: resolves repo-relative or spec-relative link targets to one repo-relative path so chunk xids/coverage joins line up, dropping non-file targets (fragments, empty strings, paths escaping the repo root). */

import { posix } from "node:path";

/** Normalizes an inline-link `target` to a repo-relative POSIX path (leading `./`/`../` resolves against the spec's directory), or null when not a usable file target; any `#fragment` is stripped first. */
export function repoRelativeLinkTarget(
  specFilePath: string,
  target: string,
): string | null {
  const path = target.split("#")[0];

  if (path === "") {
    return null;
  }
  const resolved =
    path.startsWith("./") || path.startsWith("../")
      ? posix.normalize(posix.join(posix.dirname(specFilePath), path))
      : path;

  if (resolved === "" || resolved === "." || resolved.startsWith("..")) {
    return null;
  }

  return resolved;
}
