/**
 * spec-link-index — reads the org's spec/adr markdown and builds the
 * test-file → linked-lines index the `require-spec-link` rule matches against.
 *
 * The source of truth for a spec↔test link lives INSIDE the spec.md/adr `.md`
 * as an inline trailing parenthetical — `([validated by](path/to/test.ts#L42))`
 * — parsed by the canonical `linksForStatements` (reused here, not re-implemented).
 * Each test link contributes its `#Lline` to that test path's line set; a link
 * with no `#L` anchor marks the whole file linked.
 *
 * Split out of the rule so the pure index (buildLinkIndex) and the filesystem
 * walk (readSpecFiles) are testable without a RuleTester.
 */

import fs from "node:fs";
import path from "node:path";
import { linksForStatements, resolveLinkPath } from "./lore-shared.mjs";

/** @typedef {{ lines: Set<number>, wholeFile: boolean }} LinkEntry */

export function toPosix(filePath) {
  return filePath.split(path.sep).join("/");
}

/** True when at least one of `dirs` exists under `root`. The rule uses this to
 * tell "no test is linked" from "the corpus was never found" (e.g. eslint run
 * from a subdirectory where `context.cwd` is not the repo root). */
export function corpusExists(root, dirs = ["specs", "adrs"]) {
  return dirs.some((dir) => fs.existsSync(path.join(root, dir)));
}

/**
 * Fold every test link found across the given markdown files into a
 * `Map<repoRelTestPath, LinkEntry>`. Href paths are resolved to canonical
 * repo-root-relative form via the shared `resolveLinkPath` — the same resolver
 * the graph binder uses — so a `../`-relative href (relative to the spec's own
 * directory, as GitHub renders it) indexes under the test's repo-relative key
 * and matches, instead of a literal `../../apps/x.test.ts` miss.
 *
 * @param {Array<{ path: string, content: string }>} files
 * @returns {Map<string, LinkEntry>}
 */
export function buildLinkIndex(files) {
  const index = new Map();

  for (const file of files) {
    for (const { testLinks } of linksForStatements(file.content)) {
      for (const link of testLinks) {
        const key = resolveLinkPath(link.path, file.path);
        let entry = index.get(key);

        if (!entry) {
          entry = { lines: new Set(), wholeFile: false };
          index.set(key, entry);
        }

        if (link.line === null) {
          entry.wholeFile = true;
        } else {
          entry.lines.add(link.line);
        }
      }
    }
  }

  return index;
}

/**
 * Read every `*.md` under each of `dirs` (relative to `root`), returning
 * `{ path, content }` with a root-relative posix path. Absent dirs are skipped.
 *
 * @param {string} root
 * @param {string[]} [dirs]
 * @returns {Array<{ path: string, content: string }>}
 */
export function readSpecFiles(root, dirs = ["specs", "adrs"]) {
  const files = [];

  for (const dir of dirs) {
    const base = path.join(root, dir);

    if (!fs.existsSync(base)) {
      continue;
    }

    for (const entry of fs.readdirSync(base, { recursive: true })) {
      if (!entry.endsWith(".md")) {
        continue;
      }
      const full = path.join(base, entry);

      files.push({
        path: toPosix(path.relative(root, full)),
        content: fs.readFileSync(full, "utf8"),
      });
    }
  }

  return files;
}
