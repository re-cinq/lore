/** spec-traceability-graph test-run ↔ statement binder (ADR-023): pure inverter stamping each {@link TestDescriptor} whose span contains an inline `([validated by](test.ts#Lline))` link with a `spec` anchor, so `list-tests.mjs` output feeds live pass/fail into `Statement.validated_by`/`violated`. Zero LLM, zero graph I/O. */

import {
  linksForStatements,
  normalizePath,
  resolveLinkPath,
} from "../../domain/spec-link-parser.js";
import type { TestDescriptor } from "../../domain/test-report.js";

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

export function bindDescriptorsToSpecLinks(
  descriptors: TestDescriptor[],
  specs: SpecSource[],
): TestDescriptor[] {
  const index = buildLinkIndex(specs);

  return descriptors.map((descriptor) => {
    // A descriptor that already names its spec keeps it: the author's own anchor outranks anything inferred from line ranges.
    if (descriptor.spec !== undefined) {
      return descriptor;
    }
    const anchors = anchorsFor(index, descriptor);

    if (anchors.length === 0) {
      return descriptor;
    }

    return { ...descriptor, spec: anchors.length === 1 ? anchors[0] : anchors };
  });
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

/** The spec anchors whose `([validated by](file#Lline))` link falls INSIDE this test's own line range. A descriptor with no line bounds gets none — the runner could not say where the test is, so nothing can be said about which links point at it. */
function anchorsFor(
  index: ReturnType<typeof buildLinkIndex>,
  descriptor: TestDescriptor,
): string[] {
  const { startLine, endLine } = descriptor;

  if (startLine === undefined || endLine === undefined) {
    return [];
  }
  const file = normalizePath(descriptor.file);
  const inRange = (entry: LinkIndexEntry): boolean =>
    entry.path === file && entry.line >= startLine && entry.line <= endLine;

  return [...new Set(index.filter(inRange).map((entry) => entry.anchor))];
}
