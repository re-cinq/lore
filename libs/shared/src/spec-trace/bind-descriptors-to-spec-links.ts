/** spec-traceability-graph test-run ↔ statement binder (ADR-023): pure inverter stamping each {@link TestDescriptor} whose span contains an inline `([validated by](test.ts#Lline))` link with a `spec` anchor, so `list-tests.mjs` output feeds live pass/fail into `Statement.validated_by`/`violated`. Zero LLM, zero graph I/O. */

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
  return specs.flatMap((spec) =>
    linksForStatements(spec.content).flatMap(({ statement, testLinks }) =>
      testLinks.flatMap((link) =>
        link.line === null
          ? []
          : [
              {
                path: resolveLinkPath(link.path, spec.path),
                line: link.line,
                anchor: `${spec.path}#${statement.ordinal}`,
              },
            ],
      ),
    ),
  );
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
