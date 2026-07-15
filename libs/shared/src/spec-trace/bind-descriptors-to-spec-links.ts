/**
 * spec-traceability-graph — the test-run ↔ statement binder (ADR-023).
 *
 * Pure inverter from a repo's spec markdown + its parsed {@link TestDescriptor}s
 * to the same descriptors with a `spec` anchor (`specPath#ordinal`) stamped on
 * each one whose test FILE + line span the project links from a statement. It
 * reuses {@link linksForStatements} to read every statement's inline
 * `([validated by](test.ts#Lline))` links, indexes them by `(path, line)`, and
 * binds a descriptor when its `[startLine, endLine]` span contains a link's line.
 *
 * The producer (`list-tests.mjs`) applies this after segmentation so anchored
 * descriptors reach `/test-report`, where `ingestTestReport`'s existing anchor
 * path turns them into `Statement.validated_by` + `violated` edges — making the
 * inline links a live pass/fail signal on every run. Zero LLM, zero graph I/O.
 *
 * A descriptor whose span resolves to a single statement is stamped with that
 * one anchor (a string); a span resolving to several distinct statements is
 * stamped with all of them (a `string[]`), so one test validating several
 * statements links them all (`parseSpecAnchors` reads either shape downstream).
 */

import {
  linksForStatements,
  normalizePath,
  resolveLinkPath,
} from "../spec-link-parser.js";
import type { TestDescriptor } from "../test-report.js";

/** One spec file's path + raw markdown — the binder's read source. */
export interface SpecSource {
  path: string;
  content: string;
}

interface LinkIndexEntry {
  path: string;
  line: number;
  anchor: string;
}

/** Flatten every spec's statements into `(test path, line) → statement anchor` entries. */
function buildLinkIndex(specs: SpecSource[]): LinkIndexEntry[] {
  const entries: LinkIndexEntry[] = [];

  for (const spec of specs) {
    for (const { statement, testLinks } of linksForStatements(spec.content)) {
      for (const link of testLinks) {
        if (link.line === null) {
          continue;
        }
        entries.push({
          path: resolveLinkPath(link.path, spec.path),
          line: link.line,
          anchor: `${spec.path}#${statement.ordinal}`,
        });
      }
    }
  }

  return entries;
}

export function bindDescriptorsToSpecLinks(
  descriptors: TestDescriptor[],
  specs: SpecSource[],
): TestDescriptor[] {
  const index = buildLinkIndex(specs);

  return descriptors.map((descriptor) => {
    const { startLine, endLine, spec } = descriptor;

    if (spec !== undefined) {
      return descriptor;
    }

    if (startLine === undefined || endLine === undefined) {
      return descriptor;
    }

    const file = normalizePath(descriptor.file);
    const anchors = [
      ...new Set(
        index
          .filter(
            (entry) =>
              entry.path === file &&
              entry.line >= startLine &&
              entry.line <= endLine,
          )
          .map((entry) => entry.anchor),
      ),
    ];

    if (anchors.length === 0) {
      return descriptor;
    }

    return { ...descriptor, spec: anchors.length === 1 ? anchors[0] : anchors };
  });
}
