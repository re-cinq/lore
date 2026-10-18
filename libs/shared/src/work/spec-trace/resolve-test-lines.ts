/** Per-it line resolver (ADR-023); scans test source for it/test declarations and stamps [startLine, endLine] on matching descriptors. */

import type { TestDescriptor } from "../../domain/test-report.js";
import {
  testDeclarations,
  type TestDeclaration,
} from "../../domain/spec-trace/test-declarations.js";

export function resolveTestLines(
  content: string,
  descriptors: TestDescriptor[],
): TestDescriptor[] {
  const declarations = testDeclarations(content);
  const lastLine = content.split("\n").length;

  return descriptors.map((descriptor) =>
    stampLines(descriptor, declarations, lastLine),
  );
}

/** One descriptor stamped with the [startLine, endLine] of its matching declaration; unmatched descriptors pass through untouched. */
function stampLines(
  descriptor: TestDescriptor,
  declarations: TestDeclaration[],
  lastLine: number,
): TestDescriptor {
  const leaf = leafName(descriptor.name);
  const index = declarations.findIndex(
    (declaration) => declaration.name === leaf,
  );

  if (index === -1) {
    return descriptor;
  }
  const hasNext = index + 1 < declarations.length;

  return {
    ...descriptor,
    startLine: declarations[index].line,
    endLine: hasNext ? declarations[index + 1].line - 1 : lastLine,
  };
}

function leafName(descriptorName: string): string {
  const segments = descriptorName.split(" > ");

  return segments[segments.length - 1];
}
