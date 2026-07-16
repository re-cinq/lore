/**
 * doc-kind — which corpus a markdown file belongs to.
 *
 * Shared by the three markdown rules (`require-statement-links`,
 * `require-intro-paragraph`, `require-status-matches-coverage`), each of which
 * gates on it and then hands the kind to a spec-vs-ADR aware parser.
 */

/** spec.md lives under `specs/`, ADRs under `adrs/`; anything else is out of scope. */
export function docKind(filename) {
  const posix = filename.split("\\").join("/");

  if (posix.includes("/adrs/") || posix.startsWith("adrs/")) {
    return "adr";
  }

  if (posix.includes("/specs/") || posix.startsWith("specs/")) {
    return "spec";
  }

  return null;
}
