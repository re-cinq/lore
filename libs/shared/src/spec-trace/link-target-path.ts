/**
 * spec-traceability-graph — inline-link target normalizer. Inline test/code
 * links in a spec are written either repo-relative (`shared/src/a.ts`, the
 * common case) or relative to the spec file (`../../shared/src/a.ts`). This
 * resolves both to a single repo-relative path so chunk xids and coverage joins
 * line up, and drops targets that aren't files — bare fragments (`#heading`),
 * empty strings, or paths that escape the repo root.
 */

import { posix } from "node:path";

/**
 * Normalizes an inline-link `target` (as authored in `specFilePath`) to a
 * repo-relative POSIX path, or returns null when it isn't a usable file target.
 * A leading `./`/`../` resolves against the spec's directory; anything else is
 * already repo-relative. Any `#fragment` is stripped first.
 */
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
