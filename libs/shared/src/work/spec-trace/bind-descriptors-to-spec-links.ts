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
  line: number | null;
  hash: string | null;
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

/** Flatten every spec's statements into `(test path, line, hash) → statement anchor` entries; a link with neither a line nor a hash names no test. */
function buildLinkIndex(specs: SpecSource[]): LinkIndexEntry[] {
  return specs.flatMap((spec) =>
    linksForStatements(spec.content).flatMap(({ statement, testLinks }) =>
      testLinks.flatMap((link) =>
        link.line === null && link.hash === null
          ? []
          : [
              {
                path: resolveLinkPath(link.path, spec.path),
                line: link.line,
                hash: link.hash,
                anchor: `${spec.path}#${statement.ordinal}`,
              },
            ],
      ),
    ),
  );
}

/** The spec anchors whose links name this test: by the content hash of its declaration line when it has one, else a hashless link whose line falls INSIDE the test's own line range. A hashed link never binds by line, so a stale anchor cannot pin a statement on the wrong test. */
function anchorsFor(
  index: LinkIndexEntry[],
  descriptor: TestDescriptor,
): string[] {
  const file = normalizePath(descriptor.file);
  const inFile = index.filter((entry) => entry.path === file);
  const byHash = inFile.filter(
    (entry) => entry.hash !== null && entry.hash === descriptor.anchorHash,
  );
  const matched =
    byHash.length > 0 ? byHash : inFile.filter(lineInside(descriptor));

  return [...new Set(matched.map((entry) => entry.anchor))];
}

/** A hashless link whose line lies in the test's span. A descriptor with no line bounds gets none: the runner could not say where the test is. */
function lineInside(
  descriptor: TestDescriptor,
): (entry: LinkIndexEntry) => boolean {
  const { startLine, endLine } = descriptor;

  return (entry) =>
    entry.hash === null &&
    entry.line !== null &&
    startLine !== undefined &&
    endLine !== undefined &&
    entry.line >= startLine &&
    entry.line <= endLine;
}
